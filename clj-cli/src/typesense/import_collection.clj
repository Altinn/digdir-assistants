(ns typesense.import-collection
  (:gen-class)
  (:require [clj-http.client :as http]
            [cheshire.core :as json]
            [clojure.java.io :as io]
            [clojure.tools.cli :refer [parse-opts]]))

(def typesense-config
  {:nodes [{:host (System/getenv "TYPESENSE_API_HOST")
            :port 443
            :protocol "https"}]
   :api-key (System/getenv "TYPESENSE_API_KEY_ADMIN")})
 
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
    :parse-fn #(Integer/parseInt %)] ;; Added skip option
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
            {:keys [field value take skip]} options] ;; Added skip to options
        (println "Importing documents into collection:" collection-name)
        (when (and field value)
          (println "Applying filter:" field "=" value))
        (when take
          (println "Limiting import to" take "documents"))
        (when skip
          (println "Skipping first" skip "documents"))
        (let [temp-file (str #_(System/getProperty "java.io.tmpdir")
                         "."
                             "/typesense_import_temp.jsonl")]
          (filter-documents input-file temp-file field value take skip) ;; Pass skip to filter-documents

          (let [imported-data (import-collection collection-name temp-file)
                parsed-data (json/parse-string imported-data true)
                code-counts (frequencies (map :code parsed-data))]
            (println "Import result:" parsed-data)
            (println "Summary of :code counts:" code-counts)
            #_(io/delete-file temp-file)))))))
