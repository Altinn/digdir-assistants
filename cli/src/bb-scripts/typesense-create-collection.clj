#!/usr/bin/env bb

(require '[babashka.process :refer [shell]]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(def typesense-config
  {:nodes [{:host (System/getenv "TYPESENSE_API_HOST")
            :port 443
            :protocol "https"}]
   :api-key (System/getenv "TYPESENSE_API_KEY_ADMIN")})

(defn collection-exists? [collection-name]
  (let [url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/collections/" collection-name)
        curl-command (str "curl -s -o /dev/null -w \"%{http_code}\" -H \"X-TYPESENSE-API-KEY: " 
                         (:api-key typesense-config) "\" " url)]
    (= "200" (-> (shell {:out :string} curl-command)
                 :out
                 str/trim))))

(defn create-collection [schema]
  (let [url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/collections")
        curl-command (str "curl -X POST -H \"X-TYPESENSE-API-KEY: " 
                         (:api-key typesense-config) 
                         "\" -H \"Content-Type: application/json\" " 
                         url 
                         " -d '" 
                         (json/generate-string schema) 
                         "'")]
    (-> (shell {:out :string} curl-command)
        :out
        (json/parse-string true))))

(let [collection-name (first *command-line-args*)
      schema-file (second *command-line-args*)]
  (if (and collection-name schema-file)
    (try
      (println "Creating collection:" collection-name)
      (if (collection-exists? collection-name)
        (do
          (println "Error: Collection" collection-name "already exists")
          (System/exit 1))
        (let [schema (json/parse-string (slurp schema-file) true)
              result (create-collection schema)]
          (println "Collection successfully created:" collection-name)))
      (catch Exception e
        (println "Error:" (.getMessage e))
        (System/exit 1)))
    (println "Usage: bb typesense-create-collection.clj <collection-name> <schema-file>")))
