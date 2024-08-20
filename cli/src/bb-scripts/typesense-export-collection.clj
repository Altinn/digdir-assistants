#!/usr/bin/env bb

(require '[babashka.process :refer [shell]])

(def typesense-config
  {:nodes [{:host (System/getenv "TYPESENSE_API_HOST")
            :port 443
            :protocol "https"}]
   :api-key (System/getenv "TYPESENSE_API_KEY_ADMIN")})

(defn export-collection [collection-name]
  (let [url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/collections/" collection-name "/documents/export")
        curl-command (str "curl -H \"X-TYPESENSE-API-KEY: " (:api-key typesense-config) "\" " url)]
    (-> (shell {:out :string} curl-command)
        :out
        #_str/split-lines)))

(defn save-to-file [data filename]
  (if (.exists (java.io.File. filename))
    (do
      (print (str "File " filename " already exists. Overwrite? (y/n): "))
      (flush)
      (let [response (read-line)]
        (if (= (clojure.string/lower-case response) "y")
          (spit filename data)
          (do
            (println "Export cancelled.")
            (System/exit 0)))))
    (spit filename data)))

(let [collection-name (first *command-line-args*)
      current-date (-> (java.time.LocalDate/now)
                       (.format (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd")))
      output-file (str collection-name "_export_" current-date ".jsonl")]
  (if collection-name
    (do
      (println "Exporting collection:" collection-name)
      (let [exported-data (export-collection collection-name)
            newline-count (count (filter #(= % \newline) exported-data))
            ]
        (save-to-file exported-data output-file)
        (println "Exported" newline-count "documents to" output-file)))
    (println "Please provide a collection name as an argument.")))
