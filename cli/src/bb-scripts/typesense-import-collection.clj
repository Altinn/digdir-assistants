#!/usr/bin/env bb

(require '[babashka.process :refer [shell]] 
         '[cheshire.core :as json]
         '[clojure.java.io :as io])

(def typesense-config
  {:nodes [{:host (System/getenv "TYPESENSE_API_HOST")
            :port 443
            :protocol "https"}]
   :api-key (System/getenv "TYPESENSE_API_KEY_ADMIN")})


(defn filter-documents [input-file output-file field value]
  (with-open [rdr (io/reader input-file)
              wtr (io/writer output-file)]
    (->> (line-seq rdr)
         (keep (fn [line]
                 (let [doc (json/parse-string line true)]
                   (when (or (nil? field)
                             (= (get doc (keyword field)) value))
                     line))))
         (run! #(.write wtr (str % "\n"))))))

(defn import-collection [collection-name filename]
  (let [url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/collections/" collection-name "/documents/import?action=upsert")
        curl-command (str "curl -X POST -H \"X-TYPESENSE-API-KEY: " (:api-key typesense-config)
                          "\" -H \"Content-Type: application/jsonl\" --data-binary @" filename " " url)]
    (-> (shell {:out :string} curl-command)
        :out)))

(let [collection-name (first *command-line-args*)
      input-file (second *command-line-args*)
      field (nth *command-line-args* 2 nil)
      value (nth *command-line-args* 3 nil)]
  (if (and collection-name input-file)
    (do
      (println "Importing documents into collection:" collection-name)
      (when (and field value)
        (println "Applying filter:" field "=" value))
      (let [temp-file (str (System/getProperty "java.io.tmpdir")
                           "/typesense_import_temp.jsonl")]
        (filter-documents input-file temp-file field value)
        (let [imported-data (import-collection collection-name temp-file)]
          (println "Import result:" imported-data)
          (io/delete-file temp-file))))
    (println "Usage: <collection-name> <input-file> [field] [value]")))
