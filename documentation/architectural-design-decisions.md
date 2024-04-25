# Architecture and design decisions

## Database as a service

When considering alternatives for storing stateful and static data for Altinn Assistant, we prioritized the following desirable characteristics:

1. **Real-time Data Synchronization**: Supabase provides real-time change data notification and synchronization capabilities and offers client implementations for multiple langauages, including TypeScript.
2. **Integration with Other Services**: Supabase provides native integration with other services, such as Supabase Auth, Supabase Realtime, and Supabase Storage, making it easy to build comprehensive applications.
3. **Open-Source**: Supabase is open-source, which means that it is free, and the source code is publicly available for anyone to inspect, modify, and contribute to.
4. **Self-host and cloud hosting options**: Supabase provides a secure cloud hosting environment for database storage and query execution. Additionally, Supabase Functions can be hosted within a secure cloud subnetwork without the administrative overhead normally required.
5. **Web-based Interface**: Supabase provides a simplified web-based interface for managing databases, users, and permissions, making it easy to set up and manage databases. This interface was especially relevant during the early stages of prototyping and postponed the urgency of developing a custom admin interface.
6. **SQL and NoSQL Support**: Supabase supports both SQL and NoSQL data models, allowing developers to choose the best approach for their application's specific needs.
7. **Performance**: Supabase uses a highly optimized PostgreSQL engine, which is renowned for its performance and reliability. Supabase also provides multiple geographic locations for data storage, ensuring lower latency and faster query times.
8. **Language agnostic**: Supabase Functions support multiple programming languages, making it accessible to a wide range of developers.
9. **Scalability**: Supabase is designed to scale horizontally, allowing it to handle large volumes of data and high traffic, making it suitable for high-traffic applications. 
10. **High Availability**: Supabase uses a distributed architecture, ensuring that data is replicated across multiple nodes, ensuring high availability even in the event of node failures or network outages.
11. **Security**: Supabase provides enterprise-grade security features, including encryption at rest and in transit, fine-grained access control, and built-in auditing and logging.
12.  **PostgreSQL Compatibility**: Supabase is fully compatible with PostgreSQL, allowing developers to leverage their existing knowledge and skills.
13. **API-based**: Supabase provides a robust API for interacting with the database, making it easy to integrate with other applications and services.
14. **Automated Backup and Recovery**: Supabase provides automated backup and recovery features, ensuring that data is safely backed up and can be quickly restored in the event of a disaster.



  