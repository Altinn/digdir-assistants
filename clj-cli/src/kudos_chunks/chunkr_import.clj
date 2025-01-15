(ns kudos-chunks.chunkr-import
  (:require [clojure.java.io :as io]
            [clojure.string :as str]
            [clj-http.client :as http]
            [cheshire.core :as json]
            [typesense.search :refer [multi-search multi-filter]]
            [typesense.import-collection :refer [upsert-collection]]
            [typesense.files-metadata :refer [upsert-file-chunkr-status get-file-metadata]]
            [taoensso.timbre :as log]
            [lib.converters :refer [sha1]]))

(def ^:private config
  {:api-key (System/getenv "CHUNKR_API_KEY")
   :base-url "https://api.chunkr.ai/api/v1"
  ;;  :base-url "https://api.chunkr.digdir.cloud"
   })



(defn- make-request
  "Make an authenticated request to Chunkr API"
  [method endpoint opts & {:keys [content-type] :or {content-type "application/json"}}]
  (let [base-request {:method method
                     :url (str (:base-url config) endpoint)
                     :headers {"Authorization" (str (:api-key config))}
                     :as :json}
        request (if (:multipart opts)
                 (merge base-request opts)  ; For multipart requests, don't set Content-Type
                 (merge base-request
                        {:headers {"Authorization" (str (:api-key config))
                                 "Content-Type" content-type}}
                        opts))]
    ;; (log/debug "Making request to Chunkr API:" (pr-str (dissoc request :headers)))
    ;; (log/trace "Complete request (including headers):" (pr-str request))
    (http/request request)))

(defn markdown-content [chunks]
  (let [content (->> chunks
                     (mapcat :segments)
                     (map #(get % :markdown "")) ;; Use empty string as default if :markdown is missing
                     (str/join "\n"))]
    content))

(defn chunkr-chunks->typesense-chunks
  "Convert Chunkr chunks to Typesense document format"
  [chunks doc-num]
  (map-indexed
   (fn [idx chunk]
     (let [content (markdown-content [chunk])]
       {:id (str doc-num "-" idx)
        :doc_num doc-num
        :chunk_id (str doc-num "-" idx)
        :chunk_index idx
        :content_markdown content
        :markdown_checksum (sha1 content)
        :url (str doc-num "-" idx)
        :url_without_anchor (str doc-num "-" idx)
        :type "content"
        :language "no"
        :updated_at (quot (System/currentTimeMillis) 1000)
        :page_num (-> chunk :segments first :page_number)
        :token_count 0
        :item_priority 1}))
   chunks))

(defn download-pdf-to-inbox
  "Download a PDF file from the given URL to the 'pdf_inbox' folder"
  [url]
  (let [filename (last (str/split url #"/"))
        target-dir "pdf_inbox"
        target-path (str target-dir "/" filename)]
    (io/make-parents target-path)
    (with-open [in (io/input-stream url)
                out (io/output-stream target-path)]
      (io/copy in out))
    target-path))

(defn upload-pdf-to-chunkr
  "Upload a PDF file from the 'pdf_inbox' folder to Chunkr.ai OCR API"
  [filename]
  (let [file-path (str "pdf_inbox/" filename)
        file (io/file file-path)]
    (if-not (.exists file)
      (throw (ex-info "PDF file does not exist" {:path file-path}))
      (let [file-size (.length file)
            _ (println "File size:" file-size "bytes")
            _ (println "Sending request to Chunkr API...")
            response (try
                       (make-request :post "/task" 
                                   {:multipart [{:name "file"
                                               :content-type "application/pdf"
                                               :content file
                                               :filename filename}
                                              {:name "target_chunk_length"
                                               :content "1024"}
                                              {:name "model"
                                               :content "HighQuality"}
                                              {:name "ocr_strategy"
                                               :content "Auto"}]}
                                   {:content-type "multipart/form-data"})
                       (catch Exception e
                         (println "Error details:" (ex-data e))
                         (throw (ex-info "Failed to upload PDF to Chunkr"
                                         {:filename filename
                                          :file-size file-size
                                          :error (.getMessage e)}
                                         e))))]
        response))))

(defn save-chunks-to-jsonl [chunks filename]
  (with-open [writer (io/writer filename)]
    (doseq [chunk chunks]
      (.write writer (str (json/generate-string chunk) "\n")))))

(defn get-unchunked-files [files-collection-name]
  (let [result (multi-search
                {:collection files-collection-name
                 :q "*"
                 :query-by "doc_num"
                 :include-fields "doc_num,chunkr_status"
                 :page 1
                 :per_page 1})]
    (if (:success result)
      result
      (println :error (str result)))))

;; (def chunks-to-import-filename "./typesense_chunks/chunks_to_import.jsonl")
(def docs-collection "KUDOS_docs_2025-01-08")
(def chunks-collection "KUDOS_chunks_2025-01-11")
(def files-collection-name "KUDOS_files_2025-01-08")

(def max-retries 1)

(defn handle-error [ctx error]
  (let [{:keys [current-state file-status]} ctx
        file-id (get-in ctx [:file-status :file_id])]
    (log/error error "Error in state" current-state)
    (when file-id
      (upsert-file-chunkr-status (:files-collection-name ctx) file-id (str "error-" (name current-state))))
    (assoc ctx
           :error error
           :error-state current-state)))

(def states
  {:init {:next :downloading-pdf
          :action (fn [ctx]
                    (try
                      (log/info "Starting PDF conversion for doc_num:" (:doc-num ctx))
                      (let [file-status (get-file-metadata (:files-collection-name ctx) (:doc-num ctx))]
                        (log/debug "Got file status:" file-status)
                        (assoc ctx :file-status file-status))
                      (catch Exception e
                        (handle-error ctx e))))}

   :downloading-pdf {:next :uploading-to-chunkr
                     :retryable true
                     :action (fn [ctx]
                               (try
                                 (let [{:keys [file_id kudos_url]} (:file-status ctx)]
                                   (log/info "Downloading PDF from URL:" kudos_url)
                                   (upsert-file-chunkr-status (:files-collection-name ctx) file_id "downloading-pdf")
                                   (let [filename (download-pdf-to-inbox kudos_url)]
                                     (log/debug "Downloaded PDF to:" filename)
                                     (assoc ctx :filename filename)))
                                 (catch Exception e
                                   (handle-error ctx e))))}

   :uploading-to-chunkr {:next :uploaded-to-chunkr
                         :retryable true
                         :action (fn [ctx]
                                   (try
                                     (let [{:keys [file_id]} (:file-status ctx)]
                                       (log/info "Uploading to Chunkr:" (:filename ctx))
                                       (upsert-file-chunkr-status (:files-collection-name ctx) file_id "uploading-to-chunkr")
                                       (let [upload-response (upload-pdf-to-chunkr (-> (:filename ctx) io/file .getName))]
                                         (upsert-file-chunkr-status (:files-collection-name ctx) file_id "uploaded-to-chunkr")
                                         (assoc ctx :task-id (get-in upload-response [:body :task_id]))))
                                     (catch Exception e
                                       (handle-error ctx e))))}

   :uploaded-to-chunkr {:next :chunkr-done
                        :retryable true
                        :action (fn [ctx]
                                  (try
                                    (log/info "Got Chunkr task ID:" (:task-id ctx))
                                    (loop [attempt 1]
                                      (let [task  (get-in (make-request :get (str "/task/" (:task-id ctx)) {}) [:body])
                                            file-id (get-in ctx [:file-status :file_id])
                                            status (get-in task [:status])]
                                        (log/debug "Status update " attempt " for doc_num " (:doc-num ctx) "file_id:" file-id "- status:" status)
                                        (cond
                                          (= status "Succeeded")
                                          (do
                                            (upsert-file-chunkr-status (:files-collection-name ctx)
                                                                       (get-in ctx [:file-status :file_id])
                                                                       "chunkr-done")
                                            (assoc ctx :status :completed :chunks (get-in task [:output :chunks])))
                                          
                                          (= status "Failed")
                                          (do
                                            (log/error "Chunkr task failed for file:" (get-in ctx [:file-status :file_id]))
                                            (upsert-file-chunkr-status (:files-collection-name ctx)
                                                                       (get-in ctx [:file-status :file_id])
                                                                       "error-chunkr-failed")
                                            (throw (ex-info "Chunkr task failed" 
                                                            {:task-id (:task-id ctx)
                                                             :file-id (get-in ctx [:file-status :file_id])
                                                             :status status})))
                                          
                                          :else
                                          (do
                                            (upsert-file-chunkr-status (:files-collection-name ctx)
                                                                       (get-in ctx [:file-status :file_id])
                                                                       "processing")
                                            (Thread/sleep 10000)
                                            (recur (inc attempt))))))
                                    (catch Exception e
                                      (handle-error ctx e))))}

   :chunkr-done {:next :uploading-chunks-to-typesense
                 :retryable true
                 :action (fn [ctx]
                           (try
                             (log/info "Converting chunks from Chunkr format to Typesense format...")
                             (let [
                                   chunks (get-in ctx [:chunks])]
                               (log/debug "Downloaded" (count chunks) "chunks")
                               (assoc ctx :typesense-chunks (chunkr-chunks->typesense-chunks chunks (:doc-num ctx))))
                             (catch Exception e
                               (handle-error ctx e))))}

   :uploading-chunks-to-typesense {:next :completed
                                   :retryable true
                                   :action (fn [ctx]
                                             (try
                                               (let [{:keys [file_id]} (:file-status ctx)]
                                                 (save-chunks-to-jsonl (:typesense-chunks ctx) (str "./typesense_chunks/" file_id ".jsonl"))  
                                                 (upsert-file-chunkr-status (:files-collection-name ctx) file_id "uploading-chunks-to-typesense")
                                                 (upsert-collection chunks-collection (str "./typesense_chunks/" file_id ".jsonl") 100 10)
                                                 (upsert-file-chunkr-status (:files-collection-name ctx) file_id "completed")
                                                 (log/info "Successfully completed processing for doc_num:" (:doc-num ctx))
                                                 ctx)
                                               (catch Exception e
                                                 (handle-error ctx e))))}

   :completed {:action (fn [ctx]
                         (log/info "Processing completed for doc_num:" (:doc-num ctx))
                         ctx)}})

(defn should-retry? [ctx attempt]
  (and (:error ctx)
       (get-in states [(:error-state ctx) :retryable])
       (< attempt max-retries)))

(defn run-state-machine
  "Runs the state machine with the given initial context"
  [initial-ctx]
  (let [file-status (get-file-metadata (:files-collection-name initial-ctx) (:doc-num initial-ctx))]
    (if (= (:chunkr_status file-status) "completed")
      (do
        (log/info "Skipping already completed doc_num:" (:doc-num initial-ctx))
        (assoc initial-ctx :current-state :completed))
      (loop [ctx (assoc initial-ctx :current-state :init)
             attempt 1]
        (let [current-state (:current-state ctx)
              state-config (get states current-state)
              next-state (:next state-config)
              action-fn (:action state-config)
              new-ctx (action-fn ctx)]
          (cond
            ;; Error occurred and we should retry
            (should-retry? new-ctx attempt)
            (do
              (log/warn "Retrying state" (:error-state new-ctx) "attempt" attempt "of" max-retries)
              (Thread/sleep (* 1000 attempt)) ; Exponential backoff
              (recur (assoc new-ctx :current-state (:error-state new-ctx)
                            :error nil
                            :error-state nil)
                     (inc attempt)))

            ;; Error occurred and we shouldn't/can't retry
            (:error new-ctx)
            (do
              (log/error "Failed to process doc_num:" (:doc-num new-ctx)
                         "in state:" (:error-state new-ctx)
                         "error:" (:error new-ctx))
              new-ctx)

            ;; No error, continue to next state
            next-state
            (recur (assoc new-ctx :current-state next-state) 1)

            ;; No next state, we're done
            :else new-ctx))))))

(defn process-pdf-with-chunkr
  "Download PDF, upload to Chunkr, and poll for task completion using a state machine"
  [files-collection-name doc-num]
  (run-state-machine {:files-collection-name files-collection-name
                      :doc-num doc-num}))

(defn process-unstarted-docs [files-collection-name]
  (let [query {:collection files-collection-name
               :q "*"
               :query-by "doc_num"
               :filter-by "chunkr_status:=not-started"
               :include-fields "doc_num,kudos_url"
               :per_page 100}
        result (multi-search query)]
    (if (:success result)
      (doseq [doc (get-in result [:results 0 :hits])]
        (let [url (get-in doc [:document :kudos_url])
              doc-num (get-in doc [:document :doc_num])]
          (println "Processing document:" doc-num)
          (process-pdf-with-chunkr files-collection-name url)))
      (println "Error fetching unstarted documents:" (:error result)))))

(defn get-content-markdown-for-doc [chunks-collection doc-num]
  (let [query {:collection chunks-collection
               :q doc-num
               :query-by "doc_num"
               :filter-by (str "doc_num:=" doc-num)
               :sort-by "chunk_index:asc"
               :include-fields "content_markdown"
               :per_page 1000}
        result (multi-search query)]
    (when (:success result)
      (->> result
           (:hits)
           (mapv :content_markdown)))))

(defn save-chunks-to-markdown [doc-num]
  (let [markdown-chunks (get-content-markdown-for-doc chunks-collection  doc-num)]
    (spit (str "markdown_" doc-num ".md") (apply str markdown-chunks))))

(defn get-docs-with-chunks []
  (let [page-size 30]  
    (loop [current-page 1
           all-docs []]
      (let [docs-query {:collection docs-collection
                        :q "90715"
                        :query-by "doc_num"
                        :include-fields "doc_num"
                        :per_page page-size
                        :page current-page}
            docs-result (multi-search docs-query)
            ;; _ (prn :docs-result docs-result)
            ]
        (if (and (:success docs-result)
                 (seq (get-in docs-result [:hits])))
          (let [doc-nums (mapv #(get-in % [:doc_num]) (get-in docs-result [:hits]))
                ;; _ (prn :doc-nums doc-nums)
                chunks-query {:collection chunks-collection
                              :q doc-nums
                              :query-by "doc_num"
                              :filter-by "doc_num"
                              :include-fields "doc_num"
                              :page-size 1}
                chunks-result (multi-filter chunks-query)
                ;; _ (prn :chunks-result chunks-result)
                ;; Extract doc_nums that have chunks from the chunks-result
                docs-with-chunks (set (map :doc_num (get-in chunks-result [:hits])))
                _ (prn :docs-with-chunks docs-with-chunks)
                ;; Filter current page docs to only those that have chunks
                current-docs (filter #(contains? docs-with-chunks (:doc_num %)) 
                                   (get-in docs-result [:hits]))
                _ (prn :current-docs current-docs)]
            (if (  ;; or (> current-page 30000) 
                     (< (count (get-in docs-result [:hits])) page-size)
                 )
              ; Last page reached
              (concat all-docs current-docs)
              ; More pages to process
              (recur (inc current-page)
                     (concat all-docs current-docs))))
          (do
            (when-not (:success docs-result)
              (log/error "Error fetching documents:" (:error docs-result)))
            all-docs))))))

(defn get-doc-num-list-from-chunks [] 
  (let [page-size 30]
    (loop [current-page 1
           all-doc-nums #{}]
      (let [chunks-query {:collection chunks-collection
                          :q "*"
                          :query-by "doc_num"
                          :include-fields "doc_num"
                          :facet-by "doc_num"
                          :page-size page-size
                          :page current-page}
            chunks-result (multi-search chunks-query)
            _ (prn :chunks-result chunks-result)]
        (if (:success chunks-result)
          (let [chunk-doc-num-list (set (map :doc_num (get-in chunks-result [:hits])))
                _ (prn :chunk-doc-num-list chunk-doc-num-list)]
            (if (< (count (get-in chunks-result [:hits])) page-size)
              ;; Last page reached
              (clojure.set/union all-doc-nums chunk-doc-num-list)
              ;; More pages to process
              (recur (inc current-page)
                     (clojure.set/union all-doc-nums chunk-doc-num-list))))
          (do
            (log/error "Error fetching documents:" (:error chunks-result))
            all-doc-nums))))))


(comment
  
  
  (def current-page 1)
  (def page-size 300)

  
  (def chunks-result
    (multi-search {:collection "KUDOS_chunks_2024-12-10"
                   :q "*"
                   :query-by "doc_num"
                   :include-fields "doc_num"
                   :facet-by "doc_num"
                   :page-size 30 
                   :page 1}))
  

     

  ;; import documents from KUDOS, converting them to Markdown with Chunkr.ai
  (doseq [doc-num
          [;;
          ;;  "4240"
          ;; "17306"
          ;;  "33169" 
          ;; "90715"

          ;;  "7024" "8322" "24753" "30776" "32062" "90757"
          ;;  "13769" "5075" "29038" "16940" "28778" "38024"
          ;;  "302" "22302" "22742" "24901" "26024" "26803" "27207" "30832"
          ;;  "22742" "24901" "26024" "26803" "27207" "3083
          ;;  imported with new pipeline:
          ;; "31119" "30010" "30009" "29980"
          ;; 
          ;; DSS:
          ;; "32613"   "32351" 
          ;;
          ;;  "5221" "32643" "32421" "32418" "31994" "30977" "30975" "30963" "30967" "30965" "24488" 
          ;; "22084" "16133" "2421" "5454" "2329" "2216" "16801" "2649"

           ;; "32613"
          ;;  "32613"
          ;; "16760"

          ;; ;; batch 1
          ;; "4092" "4100" "4974" "5622" "7580" "11066" "944" "3010" "10729" "12182" 
          ;;  "13390" "15631" "16091" "16584" "17906" "18433" "717" "6728" "7451" "9225" 
          ;;  "11513" "283" "1411" "1626" "2391" "2532" "4760" "7024" "11811" "15036"

          ;;  ;; batch 2
          ;;  "4760"  "15036"  "26814"  "2532"  "2700"  "75455"  "756"  "4441"  "2794"  
          ;;  "2539"  "1377"  "4963"  "16806"  "4777"  "7491"  "4995"  "6289"  "18719"  
          ;;  "18979"  "2089"  "569"  "8124"  "16873"  "2575"  "12068"  "18070"  "17261"  
          ;;  "3849"  "2172"  "3210"

          ;;  ;; batch 3 - 8 pages x 30 - windsurf
          ;;  "460" 
          ;;  "16418" "15980" "10723" "27532" "11448" "14634" "18819" "12221" "6911"
          ;;  "14111" "11071" "2154" "7544" "5007" "18321" "5298" "11217" "18464" "16191"
          ;;  "1211" "13616" "7789" "3363" "12852" "4768" "13216" "16643" "17439" "10766"
          ;;  "26480" "3867" "16468" "67829" "15308" "24580" "17829" "27542" "5379"
          ;;  "17777" "7050" "2393" "17418" "26397" "2134" "26801" "8084" "27160" "17847"
          ;;  "2972" "16317" "16880" "17883" "7671" "12625" "14219" "1457" "336" "5182"
          ;;  "649" "16347" "2013" "16372" "17486" "17598" "750" "2018" "6123" "11886"
          ;;  "1282" "16912" "14174" "1168" "25238" "7593" "27138" "6189" "18362" "1673"
          ;;  "2373" "23188" "14682" "6228" "908" "12754" "1268" "3062" "13313" "26790"
          ;;  "18197" "18227" "5699" "15388" "6754" "8836" "27352" "2364" "18024" "11207"
          ;;  "3055" "4853" "22004" "13364" "17789" "26910" "1058" "2683" "155" "4438"
          ;;  "15908" "16676" "12329" "14913" "12738" "14060" "6661" "17741" "2953" "3723"
          ;;  "24011" "230" "12540" "2361" "4484" "23217" "4078" "10" "17489" "23948"
          ;;  "13864" "1154" "8322" "5050" "8199" "6265" "24193" "15455" "26012" "18112"
          ;;  "1718" "4291" "27396" "11269" "15212" "501" "10788" "5708" "3364" "16946"
          ;;  "8010" "9136" "27381" "6051" "12279" "27070" "3473" "7588" "730" "1459"
          ;;  "15766" "1533" "14891" "3996" "1661" "7685" "27421" "17440" "15703" "15715"
          ;;  "18790" "2423" "2180" "15507" "4509" "18366" "486" "23794" "2370" "2904"
          ;;  "24434" "13750" "14290" "15083" "18439" "4153" "11368" "1212" "7872" "8644"
          ;;  "10744" "1625" "12666" "1157" "15498" "11727" "5591" "1753" "18151" "15905"
          ;;  "12078" "8498" "11571" "1654" "4726" "9082" "15499" "17578" "7360" "4061"
          ;;  "14323" "7420" "17151" "18028" "8014" "16975" "6481" "5010" "15012" "7143"
          ;;  "3605" "4391" "6475" "17759" "12435" "1067" "12481" "5953" "6914" "11563"
          ;;  "16940" "23762" "18557" "17988" "23841" "4723" "4188" "23770" "6274" "2991"
          ;;  "25018"

          ;;  ;; batch 4 - cursor
          ;;  "1730" 
          ;;  "1687" "24813" "15025" "22508" "21907" "3302" "13895" "25531" "17893" "11888" "4479" "6127" "27264" "10733" "24839" "15686" "1744" "5106" "22817" "7782" "18163" "7574" "6240" "24689" "4154" "24650" "12210" "23876" "5120"
          ;;  "7203" "27569" "13060" "22809" "23456" "3346" "23795" "25386" "21949" "9423" "16448" "938" "10833" "18852" "4040" "13668" "26347" "26386" "7009" "24977" "293" "5927" "9234" "4672" "5362" "17679" "18802" "11406" "15690" "7813"
          ;;  "3106" "13518" "901" "14491" "6897" "2819" "2876" "13673" "16021" "2864" "16668" "1883" "7677" "17919" "556" "16699" "6854" "7806" "8716" "14660" "18552" "1979" "978" "18099" "1320" "12632" "15464" "2799" "11584" "24705"
          ;;  "15392" "13628" "2388" "5259" "6343" "11214" "18408" "16951" "4549" "3910" "4941" "14945" "12388" "12416" "16016" "17572" "12209" "2305" "18192" "13591" "5403" "12331" "15917" "5185" "76616" "1361" "3938" "15202" "13415" "26477"
          ;;  "3442" "4473" "15510" "1443" "12196" "10918" "12966" "5549" "13263" "17627" "4065" "4578" "8686" "18176" "3845" "1799" "2831" "784" "15891" "10778" "16155" "18720" "2085" "550" "2088" "16444" "11586" "14673" "17243" "4960"
          ;;  "5472" "11876" "6249" "13674" "16751" "13170" "17271" "16760" "3973" "648" "18831" "13207" "1433" "2971" "17823" "15267" "11941" "18351" "11197" "3273" "17353" "15052" "4302" "4819" "6621" "8416" "7158" "14328" "2338" "27448"
          ;;  "23632" "17262" "11" "8774" "4423" "13147" "18789" "5536" "168" "3771" "26053" "4087" "11793" "90645" "90776" "90603" "90875" "14370" "32052" "4950" "14971" "6524" "5251" "14490" "5599" "14081" "1802" "7450" "6436" "8485"
          ;;  "15912" "83" "2649" "32089" "2408" "10858" "12918" "6781" "10660" "2773" "237" "13562" "17658" "9255" "3249" "6592" "8144" "8438" "11566" "6959" "17973" "13130" "16735" "16490" "14041" "12789" "17211" "18508" "13180" "15487"
          ;;  "13705" "1207" "15293" "5365" "14860" "3150" "6745" "5252" "7563" "75468" "14318" "5104" "11532" "16737" "7646" "9188" "14108" "8509" "16449" "3528" "17387" "12301" "867" "621" "14724" "5770" "7315" "16865" "14084" "16405"
          ;;  "2600" "89" "17522" "1451" "15633" "281" "3640" "3218" "2266" "2827" "12327" "4436" "341" "6024" "3278" "13670" "15100" "15102" "18264" "17077" "13586" "15970" "15051" "7037" "17301" "2812" "7956" "5366" "22320" "16435" 

          ;;  ;; batch 5 - windsurf
          ;;  "16703"
          ;;  "4442" "15039" "346" "1660" "7903" "17388" "5353" "1325" "2950" "15595" "9006" "17012" "16829" "1227" "7667" "18997" "15584" "67830" "16533" "5370" "24210" "449" "22129" "9117" "941" "12348" "33295" "4730" "11760" "7110"
          ;;  "12629" "8045" "11081" "16857" "4332" "2336" "12826" "5281" "4103" "1278" "16801" "10665" "3006" "18386" "13685" "16303" "16902" "15719" "13720" "2216" "17754" "5785" "6501" "1428" "3808" "18168" "32327" "18281" "879" "24944" "23506"
          ;;  "26334" "14603" "5910" "17019" "2657" "2798" "26731" "15882" "17198" "15682" "6008" "2970" "12462" "26192" "16038" "9229" "2554" "12530" "15241" "15808" "7416" "7693" "7472" "17182" "26324" "16173" "12095" "1290" "8784" "14267" "25801"
          ;;  "15604" "4869" "11054" "8786" "15798" "7612" "15557" "18504" "32336" "13443" "10910" "16841" "16270" "8618" "5391" "12094" "15949" "4207" "355" "7149" "18167" "2078" "11307" "14164" "95" "13683" "8056" "14757" "679" "8883" "14536" "15573"
          ;;  "2545" "14879" "1845" "17766" "16278" "9280" "11077" "27480" "5175" "9103" "15154" "3621" "4930" "10883" "2439" "414" "14788" "2090" "12089" "24978" "26310" "15166" "2329" "1176" "2343" "17805" "8365" "17507" "14296" "7542" "14286" "14592"
          ;;  "32281" "13601" "32297" "12730" "13011" "25982" "4811" "24103" "16941" "8013" "23773" "485" "3065" "17925" "26666" "16943" "13883" "27387" "12106" "25017" "17898" "15933" "7488" "32077" "1368" "8829" "16817" "15946" "5197" "116" "242" "6396"
          ;;  "3331" "10725" "23027" "22548" "4384" "2867" "32315" "5440" "13133" "9398" "16088" "3054" "15877" "2636" "3941" "3596" "22056" "5196" "27220" "14700" "8079" "16087" "24846" "9283" "581" "6504" "23671" "8066" "14988" "16289" "13531" "25320"
          ;;  "22036" "23591" "27518" "26774" "3254" "16327" "24656" "7404" "2607" "15871" "3589" "11309" "25654" "23990" "11110" "4697" "12030" "7723" "18525" "12434" "1009" "13412" "5454" "7940" "12170" "17347" "26267" "25387" "13394" "1943" "779" "16205"
          ;;  "17188" "27234" "15720" "32311" "26628" "12291" "27248" "7840" "26000" "27316" "26590" "23779" "3225" "7889" "13350" "26180" "17488" "17079" "16684" "3666" "13956" "2421" "16133" "4018" "26065" "7911" "6655" "15626" "6202" "32334" "17274"
          ;;  "17007" "15125" "27158" "23086" "23445" "24485" "24893" "25918" "26709" "5325" "14094" "23329" "598" "16766" "18103" "697"
          ;;  "4028" "6087" "25046" "12018" "23783" "26424" "27460" "26706" "25815" "23844" "25129" "26404" "27044" "32319" "23616" "25507" "26025" "22363" "23276" "23587" "24410" "26871" "23831" "26054" "25206" "22852" "26498" "23909" "27515" "27046"
          ;;  "24909" "22959" "32332" "22489" "27009" "24915" "24939" "26582" "26963" "26452" "24329" "24066" "24360" "23860" "32080" "24172" "24450" "31377" "23479" "23754" "23501" "25106" "26944" "25426" "22623" "23722" "25779" "27574" "24266" "21992"
          ;;  "25065" "25859" "25356" "24347" "22084" "76618" "23129" "24425" "25483" "27029" "26519" "22938" "26011" "21916" "22947" "24488" "27317" "26806" "24505" "26553" "26813" "23230" "25290" "22998" "26087" "26095" "23800" "26107" "27135" "26659"
          ;;  "32294" "25643" "27436" "23634" "24147" "23636" "22371" "32109" "23694" "25742" "24724" "24981" "24994" "24742" "25266" "27330" "22218" "21976" "26588" "24285" "27368" "27113" "24560" "25338" "23298" "26892" "22813" "24861" "23584" "24376"
          ;;  "24660" "26718" "24417" "24708" "27284" "23711" "22512" "23282" "25846" "24074" "25731" "25013" "26965" "26234" "25228" "26008" "27307" "90636" "90668" "90696" "90709" "90718" "90496" "90773" "90793" "90800" "90811" "90569" "90571" "90828"
          ;;  "27148" "27417" "26156" "26429" "26945" "24646" "24148" "24414" "24416" "27236" "23471" "23750" "25307" "26077" "26086" "27391" "26930" "25682" "26212" "27600" "25300" "25570" "29922" "26636" "23054" "23824" "25388" "24882" "27445" "26185"
          ;;  "24199" "25068" "24057" "23810" "25602" "24871" "27440" "24119" "25167" "26738" "27255" "27514" "24783" "25809" "25302" "24815" "22012" "24469" "24753" "27603" "24078" "25421" "23180" "24208" "25508" "23798" "22302" "22105" "24420" "27211"
          ;;  "23695" "27592" "24290" "24807" "24079" "25432" "24158" "22207" "25601" "23850" "27252" "22909" "22702" "25101" "23969" "29867" "26592" "27363" "26876" "24192" "29887" "27599" "23843" "27207" "23412" "26574" "25600" "25075" "27639" "26428"
          ;;  "23878" "22399" "25259" "27090" "21973" "26840" "25893" "24901" "24142" "22873" "26475" "27277" "22742" "26096" "24605" "27244" "32331" "22664" "26323" "23290" "24102" "24577" "76617" "25215" "25864" "23322" "23912" "23657" "26739" "23435"
          ;;  "26024" "27539" "27310" "23631" "24714" "22480" "23594" "25645" "22841" "30838" "22285" "24647" "24014" "25328" "24819" "25874" "24604" "23372" "21943" "31712" "24738" "67831" "23354" "27201" "24899" "26698" "27476" "23398" "25727" "27025"

          ;;  ;; batch 6 - for cursor instance
          ;;  "23442" "26312" "24009" "27355" "25062" "25831" "24048" "26613" "26880" "24104" "27200" "24391" "24138" "25419" "25429" "25177" "25953" "23408" "27506" "22648" "26501" "26016" "25004" "25538" "27589" "26833" "25054" "23790" "25903" "75469"
          ;;  "27111" "26399" "24112" "26883" "25949" "25970" "27057" "21930" "27245" "32314" "23724" "22636" "23560" "27154" "30746" "23868" "22352" "23496" "26619" "32085" "22216" "26367" "26091" "30835" "25529" "23966" "23473" "24279" "25343" "25344"
          ;;  "27155" "23325" "24778" "30774" "30965" "25358" "23137" "23200" "26280" "27593" "29902" "23803" "25617" "26908" "27308" "25022" "26058" "26834" "32244" "26733" "24610" "24679" "25965" "22500" "31363" "30862" "22204" "27383" "22009" "27066"
          ;;  "25060" "32054" "26217" "29884" "24507" "25798" "27336" "26851" "24327" "24989" "27265" "30766" "32607" "23155" "26231" "22485" "27150" "26154" "25735" "29864" "27572" "30901" "25118" "24894" "32084" "27227" "31329" "32116" "21924" "25047"
          ;;  "32246" "22639" "26848" "27116" "25212" "30910" "26436" "24886" "30967" "22846" "30830" "23172" "23592" "30789" "29933" "23702" "23229" "21962" "23815" "23392" "30915" "23751" "26803" "32024" "26816" "27083" "26854" "30752" "32324" "30824"
          ;;  "25485" "29901" "23381" "32325" "32328" "29917" "32316" "29874" "29898" "29919" "29870" "30760" "29935" "29929" "30778" "32318" "29873" "29875" "30897" "29879" "31422" "29931" "31974" "30748" "30820" "30846" "30856" "30898" "30927" "30773"
          ;;  "30790" "32099" "30888" "30914" "30933" "30728" "30732" "30780" "30851" "31421" "30918" "30922" "30926" "30963" "30975" "32291" "32304" "32322" "32100" "30827" "30868" "30869" "30744" "32289" "30762" "30765" "30767" "30791" "30803" "30807"
          ;;  "30812" "30863" "30865" "30913" "30795" "30798" "30848" "30796" "32120" "30919" "32018" "30739" "30883" "30893" "32290" "32588" "30805" "31332" "30823" "31339" "30837" "30840" "30845" "30860" "33245" "32074" "30818" "30844" "30881" "30890"
          ;;  "30939" "30775" "30978" "30731" "32065" "30814" "30871" "30749" "30799" "30876" "30938" "30753" "30764" "30779" "31307" "30875" "30887" "30729" "30832" "30747" "30806" "30855" "30880" "30777" "30834" "30889" "30903" "32023" "30757" "30783"
          ;;  "30761" "32320" "31331" "32230" "30763" "30902" "30917" "30928" "30745" "32064" "32307" "30924" "30980" "31416" "32145" "30970" "30966" "30755" "31415" "31964" "30857" "32009" "30974" "30894" "30968" "32373" "31308" "30962" "30977" "31313"

          ;;  "31317" "32282" "31303" "31306" "31311" "31328" "31316" "32562" "32284" "31301" "31305" "32313" "31345" "31423" "31325" "31861" "31336" "31340" "31342" "31344" "31337" "31338" "31341" "31343" "31347" "31348" "31349" "31350" "31324" "31326"
          ;;  "31327" "31333" "31346" "31855" "31417" "33240" "31424" "31426" "32288" "32601" "31364" "31390" "31361" "31362" "31367" "31374" "31378" "32245" "31859" "31920" "31413" "32283" "31863" "31420" "31418" "31425" "31702" "32102" "32196" "32028"
          ;;  "31697" "31853" "32595" "31860" "31709" "31713" "31714" "32037" "31952" "32305" "32515" "31854" "31858" "31874" "31893" "31900" "31939" "31946" "31891" "31899" "31909" "31929" "32285" "32330" "32075" "31931" "32507" "31876" "31889" "31894"
          ;;  "31897" "31915" "31937" "31941" "31945" "31701" "33238" "31979" "32012" "32299" "32045" "32071" "32090" "32092" "32107" "32119" "32636" "31871" "31879" "31884" "31892" "31895" "31903" "31906" "31908" "31913" "31914" "31918" "31921" "31922"
          ;;  "31923" "31924" "31925" "67766" "31934" "31935" "32447" "32451" "31944" "32456" "31947" "31968" "32492" "32496" "32008" "32035" "32038" "32056" "32057" "32070" "32083" "32086" "32602" "32095" "32124" "32381" "31880" "31887" "32151" "31901"
          ;;  "31912" "31928" "31940" "31948" "31961" "31966" "31969" "31981" "31982" "31993" "31994" "31963" "32260" "32010" "33297" "32025" "32027" "32031" "32034" "32046" "32048" "32049" "32050" "76619" "32078" "32338" "32088" "32104" "32113" "32115"
          ;;  "32118" "31890" "60060" "31904" "31919" "31930" "32187" "31953" "31967" "31972" "31978" "31986" "31989" "31995" "32510" "32003" "32004" "32032" "32053" "32069" "32103" "31977" "90625" "90633" "33547" "33549" "90638" "90639" "90642" "90647"
          ;;  "90655" "90656" "90657" "90672" "90673" "90679" "90680" "90681" "90682" "90686" "90687" "90690" "90704" "90707" "90708" "90457" "90459" "90460" "90719" "90465" "90721" "90725" "90470" "90472" "90731" "90476" "90477" "90735" "90480" "90739"
          ;;  "90485" "90741" "90748" "90497" "90499" "90500" "90757" "90502" "90758" "90761" "90506" "90508" "90509" "90765" "90767" "90512" "90768" "32661" "90774" "90775" "90520" "90778" "90523" "90780" "90525" "90781" "90784" "90786" "93349" "90790"
          ;;  "93350" "90535" "93351" "32679" "93352" "93353" "90795" "90796" "93356" "90542" "90798" "90799" "90545" "90801" "90802" "32693" "90552" "90809" "90554" "90556" "90813" "90558" "90559" "90819" "90823" "90568" "90825" "90826" "90572" "90829"

          ;; ;;  ;; batch 7 - for windsurf instance
          ;;  "90574" "90830" "90831" "90833" "90578" "90834" "90839" "90586" "90842" "90589" "90845" "90591" "90592" "90848" "90595" "90597" "90853" "90599" "90855" "90600" "90602" "90859" "90862" "90863" "90608" "90610" "90611" "90867" "90613" "90870"
          ;;  "90876" "90621" "90623" "32051" "32060" "32062" "75470" "31962" "31965" "31976" "31991" "32002" "32005" "32262" "32007" "32011" "32016" "32033" "32036" "32040" "32302" "31975" "31983" "31990" "32250" "31998" "32014" "32081" "32076" "32094"
          ;;  "32166" "31988" "32061" "32093" "32197" "32059" "32067" "32079" "32339" "32112" "32155" "32082" "32111" "32114" "32072" "32096" "32098" "32105" "32117" "32121" "32122" "32144" "32238" "32148" "32157" "32380" "32162" "32163" "32265" "32156"
          ;;  "32165" "32192" "32258" "32185" "32188" "32201" "32229" "32592" "32199" "32200" "32226" "32350" "32321" "32234" "32253" "32191" "32578" "32195" "32249" "32252" "32255" "32309" "32393" "32239" "32254" "32310" "32211" "32228" "32235" "32241"
          ;;  "32242" "32243" "32392" "32261" "32286" "32259" "32376" "32312" "32335" "90604" "32292" "32300" "32303" "32354" "32509" "32442" "32572" "32600" "32346" "32353" "32384" "32378" "32424" "32566" "32599" "32642" "32396" "32402" "32418" "32637"
          ;;  "32631" "32421" "32422" "32425" "32426" "32610" "32657" "32437" "32450" "32452" "32459" "32508" "32439" "32443" "32445" "32457" "32438" "32441" "32455" "32461" "32609" "32463" "32464" "32466" "32498" "32503" "32513" "33087" "32605" "32643"
          ;;  "32491" "32576" "33113" "32648" "32495" "32506" "32606" "33133" "32580" "32581" "32575" "32591" "32626" "32633" "33132" "32622" "32647" "32649" "32650" "32653" "32656" "32974" "32646" "33237" "32965" "32972" "33244" "33080" "33086" "33116"
          ;;  "33136" "33247" "33315" "90628" "46891" "47291" "47293" "64640" "90461" "90764" "75626" "72346" "78007" "80571"
          ;;  "41" "1261" "13525" "4629" "5865" "14017" "16331" "17337" "24857" "24146" "16979" "23494" "14889" "13871" "8943" "31376" "16189" "1130" "17076" "58518" "8608" "12254" "18675" "25616" "8346" "10921" "26295" "16593" "724" "12011"
          ;;  "12288" "23089" "26689" "25667" "14661" "12107" "7764" "6235" "6813" "7589" "18599" "4776" "6317" "18865" "14003" "18621" "224" "3831" "5221" "11622" "4240" "15081" "8629" "22" "27411" "75624" "26837" "14201" "18338" "5853"
          ;;  "13102" "25042" "1043" "7572" "1679" "8868" "768" "268" "13221" "18970" "10799" "8282" "1" "7992" "5438" "2857" "15784" "7780" "14316" "7921" "26909" "18559" "24750" "435" "8482" "12163" "16265" "8652" "16104" "6154"
          ;;  "14112" "302" "9048" "15778" "5322" "3310" "4097" "11018" "1557" "17194" "26069" "16381" "13211" "15839" "8496" "3584" "4682" "4957" "18836" "11428" "3013" "4104" "18964" "25671" "81" "3561" "13936" "25071" "4242" "12756"
          ;;  "26729" "2130" "17959" "11100" "8828" "13239" "15598" "3613" "9250" "6624" "12098" "9132" "17723" "23642" "15570" "15059" "1512" "5801" "9183" "7803" "4590" "4855" "2612" "9129" "3320" "2722" "2122" "23687" "22862" "24782"
          ;;  "90626" "75815" "30772" "30776" "90688" "71505" "90705" "90713" "90715" "90717" "71780" "90727" "31852" "90733" "30829" "23922" "90749" "90505" "26257" "90770" "90529" "90794" "30900" "30907" "90814" "90822" "90577" "90585" "31706" "90588"
          ;;  "75485" "90849" "75497" "90871" "90620" "25346" "21902" "24107" "22047" "32351" "27028" "32231" "31373" "23444" "23409" "23393" "27123" "24702" "31379" "29918" "76444" "29915" "25606" "23704" "24810" "23576" "32041" "24075" "26643" "25651"
          ;;  "22079" "26193" "33147" "26749" "26238" "24451" "26780" "25757" "29863" "25257" "29877" "25789" "23504" "26835" "29910" 
          ;;  "23003" 
           
          ;;  "24034" "27389" "23050" "23822" "25966" "31857" "22650" 
           
          ;;  "32969" "27617" "26013" "25597" "24555" "27466" "25806"
          ;;  "26122" "26489" "24940" "27338" "29906" "75625" "26537" "24829" "31304" "25097" "21999" "22122" "26602" "29872" "27077" "27163" "27020" 
          ;;  "26523" 
          ;;  "27577" "46922" "25195" "24091" "32251" "27206" "23440" "25888" "26149" "22256" "22157" "29865"
          ;;  "25313" "23842" "24115" "25920" "30819" "23519" "22580" "26757" "31375" "26889" "27424" "23363" "32589" "24433" "23439" "27314" "23749" "31708" "26079" "23525" "24824" "30891" "22447" "29903" "24682" 
           
          ;;  "25969" "25849" "24745" "24300" "27042"
           

          ;;  ;; batch 8 - cursor


          ;;  "26585" "21978" "26962" "25406" "29871" "23714" "29894" "32584" "29938" "29881" "29896" "29905" "29907" "29914" "30932" "33292" "30847" "30756" "30768" "30797" "30808" "30879" "30877" "30852" "30867" "30769" "30793" "46921" "31877" "31911"
          ;;  "31927" "31949" "32087" "90631" "33562" "86065" "51768" "92735" "33096" "90469" "91509" "90487" "58489" "33159" "33160" "33161" "90763" "33165" "33166" "33167" "33168" "33169" "33170" "33173" "33174" "74396" "71070" "33191" "33192" "33193"
          ;;  "33196" "33197" "63917" "93102" "33198" "33201"
          ;;  "33202"
          ;;  "33207" "33210" "33211" "33218" "33219" "85194" "33232" "94938" "91632" "91635" "60406" "90615" "33274" "32106" "33162" "33163" "33164" "33199" "33209" "33212" "33213" "33277" "33358"
          ;;  "33354" "33225" "33203" "33222" "32986" "33355" "32494" "33257" "33158" "32342" "33404" "33223" "58490" "33098" "33171" "33216" "33217" "33235" "33366" "78008" "67789" "32372" "32398" "33220" "33390" "33351" "33356" "85195" "75515" "33363"
          ;;  "33365" "33188" "33357" "33344" "32608" "32613" "33221" "67787" "67774" "67788" "33392" "33293" "33298" "32567" "33085" "32574" "33092" "32594" "32604" "33121" "33126" "33143" "33144" "33194" "33195" "33200" "33204" "67767" "33208" "32962"
          ;;  "32963" "32966" "32968" "85193" "33241" "60407" "33528" "33391" "33348" "33230" "33182" "33185" "33187" "33189" "33482" "32569" "33120" "33206" "32458" "33186" "32570" "32448" "32596" "32462" "58344" "32561" "32597" "32511" "33346" "32582"
          ;;  "32585" "32563" "33352" "33353" "33350" "33214" "33128" "33176"
          ;;  "33177" "33151" "33109" "33291" "33234" "32970" "32984" "32985" "33149" "33089" "33091" "33118" "33099" "33100" "33103" "33111" "33119" "33148" "33180" "33114" "33129" "33130"
          ;;  "33141" "46846" "33313" "33184" "33152" "33215" "33343" "33250" "33367" "33349" "33127" "33131" "33137" "33146" "33236" "33134" "33135" "33138" "33157" "33178" "33181" "33172" "74397" "33228" "33179" "33190" "85192" "33239" "33242" "33243"
          ;;  "33265" "33229" "33248" "33249" "33251" "33252" "33253" "33254" "33255" "33231" "33256" "33258" "33260" "33261" "33262" "33263" "33264"
          ;;  "33266" "33270" "33226" "33227" "33271" "33272" "33273" "33275" "33305" "33306" "33278" "33317" "33302"
          ;;  "33303" "33304" "33307" "33308" "33309" "33310" "33311" "33322" "33324" "33329" "33483" "33405" "33406" "33360" "33345" "85227" "33564" "82436" "82444" "87564" "90650" "90664" "88369" "90676" "89437" "90723" "90483" "91508" "90751" "94347"


          ;;  "90518" "90777" "90783" "90539" "86190" "84663" "90808" "90567" "90824" "90573" "90841" "82443" "86191" "86192" "87105" "84313" "82421" "79655" "82435" "84281" "84282" "83276" "84314" "84386" "84387" "84393" "84394" "84395" "82434" "85824"
          ;;  "86198" "85369" "85184" "85226" "86151" "87062" "87063" "87071" "87072" "88721" "85182" "85190" "82681" "87064" "86560" "86561" "87073" "86562" "87074" "85823" "87121" "87122" "86152" "86174" "88758" "83135" "82407" "82414" "82682" "88570"
          ;;  "84526" "82680" "87081" "84792" "82881" "85228" "82969" "87065" "87075" "86569" "85110" "83137" "83143" "85265" "84133" "84139" "84140" "87255" "86153" "87040" "88599" "87103" "87104" "88722" "88723" "88761" "88778" "87254" "88574" "88582"
          ;;  "88724" "88730" "88752" "86497" "88568" "88575" "88760" "87046" "87039" "88719" "88720" "88734" "88779" "88572" "88573" "88656" "89248" "88657" "88655" "88637" "88638" "88641" "88648" "88654" "88731" "88733" "88759" "88780" "88626" "88636"
          ;;  "88567" "88569" "88576" "88583" "88600" "88639" "88571" "88299" "88777" "88630" "88886" "88887" "88888" "88890" "88891" "88892" "88893" "88894" "88895" "88640" "88642" "88906" "88907" "88908" "88909" "88658" "88940" "88941" "88942" "88943"
          ;;  "88949" "88950" "88956" "88781" "88782" "89042" "88788" "88789" "88790" "89048" "89049" "89050" "89191" "89451" "89460" "89449" "89450" "89458" "89459" "89452" "89697" "89698" "89696" "91398" "91399" "91395" "91396" "91397" "91400" "92303"
          ;;  "92304" "92305" "92753" "92754" "93114" "93951" "94218" "94219" "94220" "94221" "94851"

;; evalueringer - windsurf

;; "31179" "31190" "14123" "31077" "31078" "29982" "29969" "31088" "31090" "29979"
;; "31107" "31108" "29976" "29974" "29978" "29977" "29973" "29981" "29983" "29972"
;; "29975" "29971" "31166" "31168" "29965" "29966" "29967" "29968" "29980" "29970"
;; "4752" "31753" "860" "4900" "79036" "17773" "11686" "17105" "3926" "18923"
;; "17885" "4519" "1796" "2712" "12683" "127" "26427" "9279" "3907" "8390"
;; "3305" "133" "7059" "4343" "12602" "16673" "65812" "1925" "4385" "6073"
;; "18195" "65429" "12946" "5236" "5668" "7157" "6395" "46714" "4524" "7223"
;; "5079" "13092" "65499" "18432" "15884" "19067" "8752" "2751" "10551" "8790"
;; "14202" "14781" "6978" "6800" "46702" "8770" "1714" "3711" "14353" "18233"
;; "46820" "173" "8285" "617" "11620" "198" "5056" "65837" "13152" "85323"
;; "19064" "46699" "864" "447" "5270" "15801" "79037" "13303" "16233" "12441"
;; "3372" "11459" "15239" "11302" "26874" "27570" "25158" "21981" "65614" "23572"
;; "79038" "65830" "25409" "65771" "46796" "79039" "25312" "65760" "31191" "31208"
;; "31207" "31205" "27161" "22365" "46849" "47514" "31178" "32128" "32132" "22096"
;; "29899" "30886" "31187" "31203" "31297" "31298" "31387" "31389" "31395" "31396"
;; "31694" "31811" "31872" "31878" "31938" "31950" "32142" "47991" "48027" "48120"
;; "48159" "48160" "48198" "48317" "48324" "48334" "48336" "48338" "48361" "48373"
;; "48376" "48377" "48378" "48384" "48443" "48934" "48936" "48939" "48946" "48948"
;; "49006" "49024" "49082" "49104" "49175" "49323" "49345" "49507" "49826" "49827"
;; "49852" "49889" "49890" "49892" "49893" "49917" "49918" "49922" "49926" "49938"
;; "50346" "50728" "50783" "51733" "51744" "51763" "51766" "51811" "70565" "70739"
;; "70936" "71212" "77223" "77259" "77265" "77269" "77285" "77290" "77295" "77320"
;; "79585" "6526" "65398" "31180" "31188" "31197" "93499" "65587" "79064" "26972"
;; "78633" "25020" "31182" "31181" "25787" "24443" "26318" "22474" "23910" "23617"
;; "27030" "31209" "31194" "31204" "26569" "26165" "31184" "31185" "31189" "31192"
;; "31195" "31196" "31199" "31201" "31206" "25881" "21941" "23710" "23951" "26195"
;; "26246" "26631" "31193" "31186" "25006" "31817" "31183" "47181" "27465" "23816"
;; "31176" "65668" "25776" "24006" "31200" "29913" "27386" "22967" "25699" "33516"
;; "74570" "46814" "27512" "27060" "47048" "31177" "29926" "65766" "31211" "78546"
;; "29927" "65816" "65822" "30735" "30822" "30786" "30801" "31212" "30815" "30831"
;; "65400" "30853" "89156" "30811" "47512" "73505" "31310" "30866" "65611" "46823"
;; "65360" "65706" "65840" "30804" "33371" "32990" "32130" "32127" "32133" "32126"

;; evaluaring - cursor
;; "32129" "32135" "32136" "32140" "32141" "32164" "32382" "65609" "31380" "77225"
;; "65735" "65875" "65876" "46824" "46825" "33577" "33340" "65524" "31360" "31368"
;; "73504" "33018" "31693" "31700" "65718" "31710" "32097" "32267" "33033" "33378"
;; "79456" "32131" "32248" "32276" "33532" "33573" "33574" "33576" "33578" "49036"
;; "49049" "49347" "49825" "49828" "49930" "49932" "49933" "49937" "49973" "50026"
;; "50210" "50343" "50345" "50364" "50464" "50618" "50747" "50779" "50784" "51120"
;; "51185" "51187" "51555" "51558" "51560" "51562" "51791" "51863" "52000" "52005"
;; "52038" "52039" "52041" "52045" "52320" "52376" "52381" "52383" "54911" "70721"
;; "70853" "70885" "70894" "70976" "70982" "70997" "71381" "71415" "71419" "71539"
;; "71541" "71542" "71545" "71579" "71587" "71728" "77044" "77119" "77195" "77260"
;; "77264" "77268" "77302" "77323" "79772" "81862" "32020" "32021" "32091" "32125"
;; "32058" "32073" "32146" "32153" "32134" "46834" "32208" "32240" "46836" "69018"
;; "32333" "33336" "32272" "32446" "32449" "32488" "32501" "79457" "33380" "32583"
;; "32598" "70761" "32652" "46845" "74568" "79458" "33507" "64806" "33456" "33494"
;; "77226" "77809" "46894" "79459" "33538" "33548" "51734" "74267" "33594" "79460"
;; "84976" "33625" "46869" "73503" "54441" "73502" "77262" "77266" "53480" "58515"
;; "60076" "60086" "71879" "74584" "74006"
;; "78451" "66801" "69019" "71871" "79182"
;; "67570" "67572" "67689" "67856" "68010" "76156" "76157" "77134" "77154" "77267"
;; "79423" "82929" "83073" "88346" "88347" "88348" "88349" "88350" "88351" "88352"
;; "88353" "88354" "88355" "88356" "88358" "88360" "88361" "88363" "88364" "88365"
;; "88366" "88367" "88368" "88371" "89311" "90188" "90189" "90190" "90191" "90192"
;; "90193" "90194" "90195" "90196" "90198" "90199" "90200" "90201" "90203" "90204"
;; "90205" "90206" "90207" "90208" "90209" "90210" "90211" "90212" "90213" "90214"
;; "90216" "90217" "90218" "90219" "77322" "72044" "73552" "73038" "74583" "78418"
;; "82994" "83134" "77890" "79010" "80768" "82103" "82106" "82107" "82109" "85109"
;; "82993" "84880" "85804" "86605" "87487" "94994" "89438" "90062" "90898" "91634"
;; "91757" "92487" "93103" "93226" "94530" 

           ;;
           ]]
    (let [_ (println "Processing document:" doc-num)]
      (process-pdf-with-chunkr files-collection-name doc-num)))


  ;; (save-chunks-to-markdown "32001")




;;   (save-chunks-to-jsonl (typesense-chunks doc-num) chunks-to-import-filename)
  
  ;; TODO: check if we need to unescape the markdown content before importing
  
  ;; (upsert-collection chunks-collection chunks-to-import-filename 100 10)
  )
