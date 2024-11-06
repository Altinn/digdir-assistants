#!/usr/bin/env bb

(require '[babashka.process :refer [shell]]
         '[cheshire.core :as json])

(def typesense-config
  {:nodes [{:host (System/getenv "TYPESENSE_API_HOST")
            :port 443
            :protocol "https"}]
   :api-key (System/getenv "TYPESENSE_API_KEY_ADMIN")})

(defn get-collection-schema [collection-name]
  (let [url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/collections/" collection-name)
        curl-command (str "curl -H \"X-TYPESENSE-API-KEY: " (:api-key typesense-config) "\" " url)]
    (-> (shell {:out :string} curl-command)
        :out)))

(defn create-collection [collection-name schema]
  (let [url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/collections")
        schema-json (json/parse-string schema true)
        updated-schema (assoc schema-json :name collection-name)
        schema-str (json/generate-string updated-schema)
        curl-command (str "curl -X POST -H \"X-TYPESENSE-API-KEY: " (:api-key typesense-config) "\" -H \"Content-Type: application/json\" -d '" schema-str "' " url)]
    (-> (shell {:out :string} curl-command)
        :out)))

(let [source-collection (first *command-line-args*)
      target-collection (second *command-line-args*)]
  (if (and source-collection target-collection)
    (do
      (println "Duplicating schema from collection:" source-collection "to" target-collection)
      (let [schema (get-collection-schema source-collection)]
        (create-collection target-collection schema)
        (println "Schema duplicated successfully."))
    )
    (println "Please provide a source collection name and a target collection name as arguments.")))
