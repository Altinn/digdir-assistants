(ns typesense.org-names
  (:require [typesense.search :refer [multi-search]]
            [typesense.admin :refer [update-docs]]))


(defn update-doc-orgs
  "Retrieves all documents from the docs-collection, one page at a time.
   Creates a set of org names, short and long, as a union of the related fields: 
   - publisher_short, recipient_short, owner_short
   
   Parameters:
   - docs-collection: The name of the documents collection
   - page-size: Number of documents per page (default: 100)
   - max-pages: Maximum number of pages to retrieve (default: 10)"
  ([docs-collection page-size max-pages]
   (loop [page 1
          all-docs []]
     (let [search-args {:collection docs-collection
                        :q "*"
                        :query-by "doc_num"
                        :include-fields "doc_num,owner_short,publisher_short,recipient_short,owner_long,publisher_long,recipient_long"
                        :page page
                        :per_page page-size}
           result (multi-search search-args)
           hits (get-in result [:hits])]
       (if (or (not (:success result))
               (empty? hits)
               (> page max-pages))
         all-docs
         (let [updated-docs
               (mapv
                (fn [hit]
                  {:id (:doc_num hit)
                   :orgs_short (vec (remove nil?
                                            [(get hit :owner_short)
                                             (get hit :publisher_short)
                                             (get hit :recipient_short)]))
                   :orgs_long (vec (remove nil?
                                           [(get hit :owner_long)
                                            (get hit :publisher_long)
                                            (get hit :recipient_long)]))})
                hits)]
           (update-docs docs-collection updated-docs) 
           (recur (inc page)
                  (into all-docs hits))))))))

(comment

  (def docs-collection "kudos_docs_2025-03-24")
;; (def chunks-collection "KUDOS_chunks_2024-12-10")
;; (def files-collection-name "KUDOS_files_2024-12-10")
  
  (update-doc-orgs docs-collection 100 50000)

  (def search-args {:collection docs-collection
                    :q "*"
                    :query-by "doc_num"
                    :include-fields "doc_num,owner_short,publisher_short,recipient_short,owner_long,publisher_long,recipient_long"
                    :page 1
                    :per_page 30})
  (def result (multi-search search-args))

  (def hits (get-in result [:hits]))

  (def updated-docs
    (mapv
     (fn [hit]
       {:id (:doc_num hit)
        :orgs_short (vec (remove nil?
                                 [(get hit :owner_short)
                                  (get hit :publisher_short)
                                  (get hit :recipient_short)]))
        :orgs_long (vec (remove nil?
                                [(get hit :owner_long)
                                 (get hit :publisher_long)
                                 (get hit :recipient_long)]))})
     hits))



  (update-docs docs-collection updated-docs)

  ;; Example usage:
  (get-all-docs 10 "doc_num,title,language")

  ;; Get all docs with all fields
  (get-all-docs)
  )
