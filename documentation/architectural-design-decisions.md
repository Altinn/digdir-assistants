# Architecture and design decisions

## Database as a service

When considering alternatives for storing stateful and static data for Altinn Assistant, we prioritized the following desirable characteristics:

1. **Real-time Data Synchronization**: Supabase provides real-time change data notification and synchronization capabilities and offers client implementations for multiple langauages, including TypeScript.
2. **Security**: Supabase provides enterprise-grade security features, including encryption at rest and in transit, fine-grained access control, and built-in auditing and logging.
3. **Integration with Other Services**: Supabase provides native integration with other services, such as Supabase Auth, Supabase Realtime, and Supabase Storage, making it easy to build comprehensive applications.
4. **Open-Source**: Supabase is open-source, which means that it is free, and the source code is publicly available for anyone to inspect, modify, and contribute to.
5. **Self-host and cloud hosting options**: Supabase provides a secure cloud hosting environment for database storage and query execution. Additionally, Supabase Functions can be hosted within a secure cloud subnetwork without the administrative overhead normally required.
6. **Web-based Interface**: Supabase provides a simplified web-based interface for managing databases, users, and permissions, making it easy to set up and manage databases. This interface was especially relevant during the early stages of prototyping and postponed the urgency of developing a custom admin interface.
7. **SQL and NoSQL Support**: Supabase supports both SQL and NoSQL data models, allowing developers to choose the best approach for their application's specific needs.
8. **Performance**: Supabase uses a highly optimized PostgreSQL engine, which is renowned for its performance and reliability. Supabase also provides multiple geographic locations for data storage, ensuring lower latency and faster query times.
9. **Language agnostic**: Supabase Functions support multiple programming languages, making it accessible to a wide range of developers.
10. **Scalability**: Supabase is designed to scale horizontally, allowing it to handle large volumes of data and high traffic, making it suitable for high-traffic applications. 
11. **High Availability**: Supabase uses a distributed architecture, ensuring that data is replicated across multiple nodes, ensuring high availability even in the event of node failures or network outages.
12.  **PostgreSQL Compatibility**: Supabase is fully compatible with PostgreSQL, allowing developers to leverage their existing knowledge and skills.
13. **API-based**: Supabase provides a robust API for interacting with the database, making it easy to integrate with other applications and services.
14. **Automated Backup and Recovery**: Supabase provides automated backup and recovery features, ensuring that data is safely backed up and can be quickly restored in the event of a disaster.



## Functions as a service

One of the key benefits of using Supabase DB is that most data operations for our application can be achieved without any backend code. Through properly designed access control policies, we can retrieve relevant data directly from the front end application running in the browser. Especially during the early stages of prototyping, this can be a significant time saver.

Should the need arise for complicated data manipulation or querying, we can add a serverless backend function for that specific purpose, without a costly rearchitecture effort. Additionally, each function can have it's own scaling configuration, source code language and security context. While not suitable for all workloads, Supabase Functions have the general benefits associated with serverless runtimes in general:

* **Cost savings**: Pay only for the resources consumed, which can lead to significant cost savings.
* **Increased scalability**: Infrastructure scaling is automated, ensuring your application can handle changing traffic patterns.
* **Reduced administrative burden**: No need to manage servers, patch software, or worry about security updates.
* **Faster deployment**: Developers can focus on writing code, rather than managing infrastructure.
* **Improved responsiveness**: Functions can respond quickly to changing traffic patterns, ensuring a better user experience.


