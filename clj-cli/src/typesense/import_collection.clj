(ns typesense.import-collection
  (:gen-class)
  (:require [clj-http.client :as http]
            [cheshire.core :as json]
            [clojure.java.io :as io]
            [clojure.string :as str]
            [clojure.tools.cli :refer [parse-opts]]
            [taoensso.timbre :as log]
            [typesense.api-config :refer [typesense-config]])
  (:import [java.time LocalDateTime]
           [java.time.format DateTimeFormatter]
           [java.util UUID]))

;; Configure timbre for UTF-8 output
(log/merge-config!
 {:output-fn (fn [data]
               (let [{:keys [level ?err msg_ ?ns-str ?file timestamp_]} data]
                 (format "[%s] %s - %s"
                         (name level)
                         (force msg_)
                         (or (some-> ?err .getMessage) ""))))
  :timestamp-opts {:pattern "yyyy-MM-dd HH:mm:ss" :timezone :jvm-default}})

 
(defn filter-documents [input-file output-file field value take skip]
  (with-open [rdr (io/reader input-file :encoding "UTF-8")
              wtr (io/writer output-file)]
    (->> (line-seq rdr)
         (drop (or skip 0)) ;; Skip the specified number of documents
         (keep (fn [line]
                 (let [doc (json/parse-string line true)]
                   (when (or (nil? field)
                             (= (get doc (keyword field)) value))
                     line))))
         (clojure.core/take (or take Long/MAX_VALUE))
         (run! #(.write wtr (str % "\n"))))))

(defn get-reference-info [collection-name field-name]
  (let [url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/collections/" collection-name)
        response (http/get url {:headers {"X-TYPESENSE-API-KEY" (:api-key typesense-config)}})
        schema (-> response :body json/parse-string (get "fields"))
        field-def (first (filter #(= (get % "name") field-name) schema))]
    (when-let [reference (get field-def "reference")]
      (let [[collection field] (clojure.string/split reference #"\.")]
        {:collection collection
         :field-name field}))))

(defn multi-search-values [collection-name field-name values]
  (let [base-url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/multi_search")
        queries (map (fn [value]
                       {:collection collection-name
                        :q "*"
                        :filter_by (str field-name ":=" value)
                        :per_page 1})
                     values)
        ;; _ (prn "queries: " queries)
        request-body {:searches queries}
        response (http/post base-url
                            {:headers {"X-TYPESENSE-API-KEY" (:api-key typesense-config)
                                       "Content-Type" "application/json"}
                             :body (json/generate-string request-body)})
        results (-> response :body json/parse-string (get "results"))]
    (->> results
         (keep (fn [result] 
                 (when (pos? (get result "found"))
                   (-> result
                       (get "hits")
                       first
                       (get "document")
                       (get field-name)))))
         set)))

(defn process-batch [collection target-field-name field-name batch wtr]
  (let [unique-key-field-values (distinct (map (keyword target-field-name) batch))
        ;; _ (prn "process-batch input - collection: " collection " target field: " target-field-name " matching field: " field-name)
        _ (prn "unique key-field values: " unique-key-field-values)
        existing-key-field-values (multi-search-values collection field-name unique-key-field-values)
        written-count (atom 0)] ;; Initialize a counter
    (doseq [doc batch]
      (let [value (get doc (keyword target-field-name))]
        (when (contains? existing-key-field-values value)
          (.write wtr (str (json/generate-string doc) "\n"))
          (swap! written-count inc)))) ;; Increment the counter
    (println "Searched for " (count unique-key-field-values) ", found " @written-count " existing parent documents"))) ;; Print the count after processing

(defn filter-existing-documents [target-collection-name target-field-name input-file output-file batch-size]
  (let [reference-info (get-reference-info target-collection-name target-field-name)]
    (if-not reference-info
      (println "No reference information found for" target-field-name "in" target-collection-name)
      (let [{:keys [collection field-name]} reference-info
            _ (prn " lookup-collection: " collection " lookup-field-name: " field-name)]
        (with-open [rdr (io/reader input-file :encoding "UTF-8")
                    wtr (io/writer output-file)]
          (doseq [batch (partition-all batch-size (line-seq rdr))]
            (process-batch collection target-field-name field-name 
                           (map #(json/parse-string % true) batch) wtr)))))))


(defn upsert-collection [collection-name filename batch-size max-batches]
  (let [url (str (get-in typesense-config [:nodes 0 :protocol]) "://"
                 (get-in typesense-config [:nodes 0 :host]) "/collections/"
                 collection-name "/documents/import?action=upsert")
        batch-counter (atom 0)
        max-batches (or max-batches Integer/MAX_VALUE)] 
    (with-open [rdr (io/reader filename :encoding "UTF-8")]
      (doseq [batch (partition-all batch-size (line-seq rdr))]
        (let [timestamp (-> (java.time.LocalDateTime/now)
                            (.format (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd_HHmmss")))
              uuid (str (UUID/randomUUID))
              temp-file (str "." "/typesense_import_batch_" timestamp "_" uuid ".jsonl")] 
          (when (< @batch-counter max-batches)
            (swap! batch-counter inc)
            (with-open [wtr (io/writer temp-file :encoding "UTF-8")] 
              (doseq [line batch]
                (.write wtr (str line "\n"))))
            (let [batch-size (count batch)
                  start-time (System/currentTimeMillis)
                  file-size (/ (.length (io/file temp-file)) 1024.0) ;; Size in KB
                  response
                  (:body
                   (http/post url
                              {:headers {"X-TYPESENSE-API-KEY" (:api-key typesense-config)
                                         "Content-Type" "application/jsonl"}
                               :body (slurp temp-file)}))
                  end-time (System/currentTimeMillis)
                  time-taken (/ (- end-time start-time) 1000.0)] ;; Time in seconds
              (log/info (format "Batch %d: Uploaded %d documents (%.2f KB) in %.2f seconds (%.2f docs/sec)"
                              @batch-counter
                              batch-size
                              file-size
                              time-taken
                              (/ batch-size time-taken)))
              ;; Parse and log any errors in the response
              (let [response-items (str/split-lines response)]
                (doseq [[idx [item input]] (map-indexed vector (map vector response-items batch))]
                  (when (not= "{\"success\":true}" item)
                    (let [error (json/parse-string item true)
                          input-data (json/parse-string input true)]
                      (log/error "Import error on item" idx ":" error)
                      (log/error "Input data was:" input-data)))))
            (io/delete-file temp-file))))))))

(def cli-options
  [["-f" "--field FIELD" "Field to filter on"]
   ["-v" "--value VALUE" "Value to filter by"]
   ["-t" "--take TAKE" "Number of documents to import"
    :parse-fn #(Integer/parseInt %)]
   ["-s" "--skip SKIP" "Number of documents to skip"
    :parse-fn #(Integer/parseInt %)]
   ["-k" "--key-field KEY-FIELD" "Key field for filtering existing documents" ;; Added key-field option
    :required true] ;; Make it required
   ["-h" "--help"]])

(defn -main [& args]
  (let [{:keys [options arguments errors summary]} (parse-opts args cli-options)]
    (cond
      (:help options) (println summary)
      errors (do (run! println errors)
                 (System/exit 1))
      (< (count arguments) 2) (do (println "Usage: <collection-name> <input-file> [options]")
                                  (println summary)
                                  (System/exit 1))
      :else
      (let [[collection-name input-file] arguments
            {:keys [field value take skip key-field]} options] ;; Added key-field to options
        (println "Server host node:" (get-in typesense-config [:nodes 0 :host]))
        (println "Importing documents into collection:" collection-name)
        (when (and field value)
          (println "Applying filter:" field "=" value))
        (when take
          (println "Limiting import to" take "documents"))
        (when skip
          (println "Skipping first" skip "documents"))
        (when (not-empty key-field)
          (println "Using key field:" key-field))
        (let [needs-filtering (or (and field value) (not-empty key-field))]
          (if needs-filtering
            ;; Apply filtering if needed
            (let [next-output-file (atom "./typesense_import_filtered_temp.jsonl")]
              (filter-documents input-file @next-output-file field value take skip)
              (when (not-empty key-field)
                (let [next-input-file @next-output-file
                      _ (reset! next-output-file "./typesense_import_exists.jsonl")]
                  (prn "Only inserting documents that match in parent collection.")
                  (filter-existing-documents collection-name key-field next-input-file @next-output-file 100)))
              (upsert-collection collection-name @next-output-file 10 nil))
            ;; No filtering needed, use input file directly
            (upsert-collection collection-name input-file 5000 nil)))))))

(comment

  (upsert-collection
   "DEV_kudos-docs_2024-09-09"
   "STAGING_kudos-docs_2024-09-03_export_20240909_fixed.jsonl"
   100 nil)

  ;;DEV_kudos-chunks_2024-09-09  --key-field doc_num

  (filter-existing-documents
   "DEV_kudos-chunks_2024-09-09"
   "doc_num"
   "./STAGING_kudos-chunks_2024-09-03_export_20240909_fixed.jsonl"
   "./STAGING_kodus-chunks_2024-09-03_filtered.jsonl"
   100)

  (upsert-collection
   "DEV_kudos-chunks_2024-09-09"
   "./STAGING_kodus-chunks_2024-09-03_filtered.jsonl"
   100 nil)


  (filter-documents
   "./STAGING_kudos-phrases_2024-09-03_export_20240909_fixed.jsonl" ;; input-file
   "./STAGING_kodus-phrases_2024-09-03_filtered.jsonl" ;; output-file
   nil ;; field to filter on
   nil ;; value to filter on
   nil ;; take all
   0  ;; skip none)
   )

  (filter-existing-documents
   "DEV_kudos-phrases_2024-09-09"
   "chunk_id" ;; key-field
   "./STAGING_kodus-phrases_2024-09-03_filtered.jsonl"
   "./STAGING_kudos-phrases_2024-09-03_ready-to-import.jsonl"
   100)

  (upsert-collection
   "DEV_kudos-phrases_2024-09-09"
   "STAGING_kudos-phrases_2024-09-03_ready-to-import.jsonl"
   5000 nil)
  
  (upsert-collection
   "KUDOS_phrases_2025-01-10_test4"
   "/Volumes/models/kudos_backup/snapshot_2025-01-10/KUDOS_phrases_2025-01-10_test4_export_20250116.jsonl"
   5000 2)



  (+ 1 1)
  ;;
  )
