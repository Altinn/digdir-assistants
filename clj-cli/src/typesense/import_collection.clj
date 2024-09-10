(ns typesense.import-collection
  (:gen-class)
  (:require [clj-http.client :as http]
            [cheshire.core :as json]
            [clojure.java.io :as io]
            [clojure.tools.cli :refer [parse-opts]]
            [typesense.api-config :refer [typesense-config]]))


 
(defn filter-documents [input-file output-file field value take skip]
  (with-open [rdr (io/reader input-file)
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
    (prn "Imported " @written-count " documents"))) ;; Print the count after processing

(defn filter-existing-documents [target-collection-name target-field-name input-file output-file]
  (let [reference-info (get-reference-info target-collection-name target-field-name)]
    (if-not reference-info
      (println "No reference information found for" target-field-name "in" target-collection-name)
      (let [{:keys [collection field-name]} reference-info
            _ (prn " lookup-collection: " collection " lookup-field-name: " field-name)]
        (with-open [rdr (io/reader input-file)
                    wtr (io/writer output-file)]
          (doseq [batch (partition-all 100 (line-seq rdr))]
            (process-batch collection target-field-name field-name 
                           (map #(json/parse-string % true) batch) wtr)))))))


(defn import-collection [collection-name filename]
  (let [url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/collections/" collection-name "/documents/import")]
    (:body (http/post url
                      {:headers {"X-TYPESENSE-API-KEY" (:api-key typesense-config)
                                 "Content-Type" "application/jsonl"}
                       :body (slurp filename)}))))

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
        (println "Importing documents into collection:" collection-name)
        (when (and field value)
          (println "Applying filter:" field "=" value))
        (when take
          (println "Limiting import to" take "documents"))
        (when skip
          (println "Skipping first" skip "documents"))
        (when (not-empty key-field)
          (println "Using key field:" key-field))
        (let [next-output-file (atom (str "." "/typesense_import_filtered_temp.jsonl"))] 
          (filter-documents input-file @next-output-file field value take skip)
          (when (not-empty key-field)
            (let [next-input-file @next-output-file
                  _ (reset! next-output-file (str "." "/typesense_import_exists.jsonl"))]
              (prn "Only inserting documents that match in parent collection.")
              (filter-existing-documents collection-name key-field next-input-file @next-output-file)))
          (let [imported-data (import-collection collection-name @next-output-file)
                parsed-data (json/parse-string imported-data true)
                code-counts (frequencies (map :code parsed-data))]
            (println "Import result:" parsed-data)
            (println "Summary of :code counts:" code-counts)
            #_(io/delete-file temp-file))
          ;;
          )))))
