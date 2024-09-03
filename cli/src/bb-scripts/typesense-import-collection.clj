#!/usr/bin/env bb

(require '[babashka.process :refer [shell]])

(def typesense-config
  {:nodes [{:host (System/getenv "TYPESENSE_API_HOST")
            :port 443
            :protocol "https"}]
   :api-key (System/getenv "TYPESENSE_API_KEY_ADMIN")})

(defn import-collection [collection-name filename]
  (let [url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/collections/" collection-name "/documents/import")
        curl-command (str "curl -X POST -H \"X-TYPESENSE-API-KEY: " (:api-key typesense-config) "\" -H \"Content-Type: application/jsonl\" -T " filename " " url)]
    (-> (shell {:out :string} curl-command)
        :out)))

(let [collection-name (first *command-line-args*)
      input-file (second *command-line-args*)]
  (if (and collection-name input-file)
    (do
      (println "Importing documents into collection:" collection-name)
      (let [imported-data (import-collection collection-name input-file)]
        (println "Import result:" imported-data)))
    (println "Please provide a collection name and an input file as arguments.")))
