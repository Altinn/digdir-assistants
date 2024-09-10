(ns typesense.fixup-collection
  (:require [typesense.api-config :refer [typesense-config]]
            [cheshire.core :as json]
            [clojure.java.io :as io]))

(defn rename-doc-id-to-doc-num [input-file output-file]
  (with-open [reader (io/reader input-file)
              writer (io/writer output-file)]
    (doseq [line (line-seq reader)]
      (let [document (json/parse-string line true)
            updated-document (-> document
                                 (dissoc :doc_id)
                                 (assoc :doc_num (:doc_id document)))]
        (.write writer (str (json/generate-string updated-document) "\n"))))))
