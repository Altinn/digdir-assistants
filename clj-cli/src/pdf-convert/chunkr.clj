(ns pdf-convert.chunkr
  (:require [clojure.java.io :as io]
            [clojure.string :as str]
            [clj-http.client :as http]
            [cheshire.core :as json]
            [typesense.search :refer [multi-search multi-filter]]
            [typesense.import-collection :refer [upsert-collection]]
            [typesense.files-metadata :refer [upsert-file-chunkr-status get-file-metadata]]
            [taoensso.timbre :as log]))

(def ^:private config
  {:api-key (System/getenv "CHUNKR_API_KEY")
   :base-url "https://api.chunkr.ai/api/v1"})

(defn bytes-to-hex [bytes]
  (let [hex-chars "0123456789abcdef"]
    (apply str
           (for [b bytes]
             (let [v (bit-and b 0xFF)]
               (str (get hex-chars (bit-shift-right v 4))
                    (get hex-chars (bit-and v 0x0F))))))))

(defn sha1
  "Calculate SHA1 hash of input string"
  [s]
  (let [md (java.security.MessageDigest/getInstance "SHA-1")
        bytes (.getBytes s "UTF-8")]
    (-> md
        (.digest bytes)
        bytes-to-hex)))

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
    (log/debug "Making request to Chunkr API:" (pr-str (dissoc request :headers)))
    (log/trace "Complete request (including headers):" (pr-str request))
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
(def docs-collection "KUDOS_docs_2024-12-10")
(def chunks-collection "KUDOS_chunks_2024-12-10")
(def files-collection-name "KUDOS_files_2024-12-10")

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
                                            status (get-in task [:status])]
                                        (log/debug "Polling attempt" attempt "- Status:" status)
                                        (if (= status "Succeeded")
                                          (do
                                            (upsert-file-chunkr-status (:files-collection-name ctx)
                                                                       (get-in ctx [:file-status :file_id])
                                                                       "chunkr-done")
                                            (assoc ctx :status :completed :chunks (get-in task [:output :chunks])))
                                          (do
                                            (let [new-status (get-in (:chunks ctx) [:task :status])]
                                              (upsert-file-chunkr-status (:files-collection-name ctx)
                                                                         (get-in ctx [:file-status :file_id])
                                                                         new-status)
                                              (Thread/sleep 10000)
                                              (recur (inc attempt)))))))
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
        :else new-ctx))))

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
    (multi-search {:collection "KUDOS_chunks_2024-09-27_chunkr_test"
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
           "32613"
           ;;
           ]]
    (let [_ (println "Processing document:" doc-num)]
      (process-pdf-with-chunkr files-collection-name doc-num)))


  (save-chunks-to-markdown "32001")




;;   (save-chunks-to-jsonl (typesense-chunks doc-num) chunks-to-import-filename)
  
  ;; TODO: check if we need to unescape the markdown content before importing
  
  ;; (upsert-collection chunks-collection chunks-to-import-filename 100 10)
  )