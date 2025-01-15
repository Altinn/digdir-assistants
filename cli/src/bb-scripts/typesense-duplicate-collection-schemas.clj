#!/usr/bin/env bb

(require '[babashka.process :refer [shell]]
         '[cheshire.core :as json]
         '[clojure.walk :as walk])

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

(defn configure-new-schemas [original-schemas new-names]
  (let [update-references (fn [schema new-name-map]
                            (clojure.walk/postwalk
                             (fn [node]
                               (if (and (string? node)
                                        (re-find #"^/collections/[^/]+/" node))
                                 (let [[_ coll-name rest] (re-find #"^/collections/([^/]+)/(.*)" node)
                                       new-coll-name (get new-name-map coll-name coll-name)]
                                   (str "/collections/" new-coll-name "/" rest))
                                 node))
                             schema))
        name-map (zipmap (map :name original-schemas) new-names)]
    (map-indexed
     (fn [idx schema]
       (-> schema
           (assoc :name (nth new-names idx))
           (update-references name-map)))
     original-schemas)))

(defn create-collection [collection-name schema]
  (let [url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/collections")
        schema-json (json/parse-string schema true)
        updated-schema (assoc schema-json :name collection-name)
        schema-str (json/generate-string updated-schema)
        curl-command (str "curl -X POST -H \"X-TYPESENSE-API-KEY: " (:api-key typesense-config) "\" -H \"Content-Type: application/json\" -d '" schema-str "' " url)]
    (-> (shell {:out :string} curl-command)
        :out)))

(defn parse-args [args]
  (loop [remaining args
         result {:sources [] :targets []}]
    (if (empty? remaining)
      result
      (let [[flag & rest] remaining]
        (case flag
          "--sources" (let [[sources after] (split-with #(not (.startsWith % "--")) rest)]
                        (recur after (update result :sources into sources)))
          "--targets" (let [[targets after] (split-with #(not (.startsWith % "--")) rest)]
                        (recur after (update result :targets into targets)))
          (recur (rest remaining) result))))))

(let [{:keys [sources targets]} (parse-args *command-line-args*)]
  (if (and (seq sources)
           (seq targets)
           (= (count sources) (count targets)))
    (do
      (println "Duplicating schemas:")
      (doseq [[source target] (map vector sources targets)]
        (println "From:" source "to:" target))
      (let [source-schemas (map (comp #(json/parse-string % true) get-collection-schema) sources)
            new-schemas (configure-new-schemas source-schemas targets)]
        (doseq [[target schema] (map vector targets new-schemas)]
          ;; (create-collection target (json/generate-string schema))
          (println "Target: " target)
          (println (json/generate-string schema))
          (println "Schema" target "created successfully."))))
    (println "Please provide equal number of source and target collections using --sources and --targets flags.\nExample: --sources Schema1 Schema2 --targets NewSchema1 NewSchema2")))