#!/usr/bin/env bb

(require '[babashka.process :refer [shell]]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(def typesense-config
  {:nodes [{:host (System/getenv "TYPESENSE_API_HOST")
            :port 443
            :protocol "https"}]
   :api-key (System/getenv "TYPESENSE_API_KEY_ADMIN")})

(defn get-collection-schema [collection-name]
  (let [url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/collections/" collection-name)
        curl-command (str "curl -H \"X-TYPESENSE-API-KEY: " (:api-key typesense-config) "\" " url)]
    (-> (shell {:out :string} curl-command)
        :out
        (json/parse-string true))))

(defn generate-default-filename [collection-name]
  (let [timestamp (-> (java.time.LocalDateTime/now)
                     (.format (java.time.format.DateTimeFormatter/ofPattern "yyyy-MM-dd_HHmmss")))]
    (str collection-name "_schema_" timestamp ".json")))

(let [collection-name (first *command-line-args*)
      output-file (or (second *command-line-args*)
                     (generate-default-filename collection-name))]
  (if collection-name
    (try
      (println "Downloading schema for collection:" collection-name)
      (let [schema (get-collection-schema collection-name)]
        (spit output-file (json/generate-string schema {:pretty true}))
        (println "Schema successfully saved to:" output-file))
      (catch Exception e
        (println "Error:" (.getMessage e))
        (System/exit 1)))
    (println "Usage: bb typesense-download-collection-schema.clj <collection-name> [output-file]")))
