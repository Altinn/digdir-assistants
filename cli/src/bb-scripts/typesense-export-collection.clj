#!/usr/bin/env bb

(require '[babashka.process :refer [shell]]
         '[clojure.string :as string])

(def typesense-config
  {:nodes [{:host (System/getenv "TYPESENSE_API_HOST")
            :port 443
            :protocol "https"}]
   :api-key (System/getenv "TYPESENSE_API_KEY_ADMIN")})

(defn export-collection [collection-name output-file]
  (let [url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/collections/" collection-name "/documents/export")
        curl-command (str "curl -H \"X-TYPESENSE-API-KEY: " (:api-key typesense-config) "\" " url " -o " output-file)]
    (if (.exists (java.io.File. output-file))
      (do
        (print (str "File " output-file " already exists. Overwrite? (y/n): "))
        (flush)
        (let [response (read-line)]
          (if (= (string/lower-case response) "y")
            (do
              (shell curl-command)
              true)
            (do
              (println "Export cancelled.")
              false))))
      (do
        (shell curl-command)
        true))))

(let [collection-name (first *command-line-args*)
      output-folder (or (second *command-line-args*) "./") 
      current-date (-> (java.time.LocalDate/now)
                       (.format (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd")))  
      output-file (str (-> output-folder
                           (as-> folder (if (string/ends-with? folder "/") folder (str folder "/"))))
                       collection-name "_export_" current-date ".jsonl")]
  (if collection-name
    (do
      (println "Exporting collection:" collection-name)
      (if (export-collection collection-name output-file)
        (do
          (println "Export completed. File saved as" output-file)

          (let [file-size (.length (java.io.File. output-file))
                size-mb (/ file-size (* 1024 1024))]
            (if (> size-mb 500)
              (do
                (print "The file is larger than 500 MB. Do you want to count the number of documents? This may take a while. (y/n): ")
                (flush)
                (let [response (read-line)]
                  (if (= (string/lower-case response) "y")
                    (let [line-count (with-open [rdr (clojure.java.io/reader output-file)]
                                       (count (line-seq rdr)))]
                      (println "Exported" line-count "documents to" output-file))
                    (println "Skipped counting documents."))))
              (let [line-count (with-open [rdr (clojure.java.io/reader output-file)]
                                 (count (line-seq rdr)))]
                (println "Exported" line-count "documents to" output-file)))))
        (System/exit 1)))
    (println "Please provide a collection name as an argument.")))
