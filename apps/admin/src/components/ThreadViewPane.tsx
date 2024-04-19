import React, { useEffect } from "react";
import { Link, List, ListItem } from "@mui/material";
import { Props, Message } from "../models/Models";
import ThreadStart from "./ThreadStart";
import { useThreadReplies } from "../hooks/useThreadReplies";
import { RagPipelineResult } from "@digdir/assistants";

const ThreadViewPane: React.FC<Props> = ({
  channelId,
  thread_ts_date,
  thread_ts_time,
}) => {
  const {
    data: threadMessages,
    error,
    isLoading,
  } = useThreadReplies({ channelId, thread_ts_date, thread_ts_time });

  const botReplyDetails = (message: Message) => {
    if (message?.content_type != "docs_bot_reply") {
      return "";
    }
    const details = message?.content as RagPipelineResult;
    return (
      <>
        <ListItem
          style={{ flexWrap: "wrap" }}
          key={message.ts_date + "." + message.ts_time + "_1"}
        >
          <h5 style={{ flexBasis: "100%" }}>
            Phrases generated for retrieval:
          </h5>
          <ul>
            {details?.search_queries.map((query: any) => <li>{query}</li>)}
          </ul>
        </ListItem>
        <ListItem
          style={{ flexWrap: "wrap" }}
          key={message.ts_date + "." + message.ts_time + "_2"}
        >
          <h5 style={{ flexBasis: "100%" }}>Sources</h5>
          <ul>
            {details?.source_urls.map((url: string) => (
              <li key={url}>
                <Link href={url} target="_new" rel="noopener noreferrer">
                  {url.replace("https://docs.altinn.studio/", "")}
                </Link>
              </li>
            ))}
          </ul>
        </ListItem>
        <ListItem
          style={{ flexWrap: "wrap" }}
          key={message.ts_date + "." + message.ts_time + "_3"}
        >
          <h5 style={{ flexBasis: "100%" }}>Processing times</h5>
          <p style={{ flexBasis: "100%" }}>
            Total: {message?.durations?.total.toFixed(1)}
          </p>
          <ul>
            <li key="analyze">Analyze: {message?.durations?.analyze.toFixed(1)}</li>
            <li key="generate_searches">
              Generate searches:{" "}
              {message?.durations?.generate_searches.toFixed(1)}
            </li>
            <li key="phrase_similarity_search">
              Phrase similarity:{" "}
              {message?.durations?.phrase_similarity_search.toFixed(1)}
            </li>
            <li key="execute_searches">
              Execute searches:{" "}
              {message?.durations?.execute_searches.toFixed(1)}
            </li>
            <li key="rerank">Re-rank: {message?.durations?.colbert_rerank.toFixed(1)}</li>
            <li key="generate_answer">Generate answer: {message?.durations?.rag_query.toFixed(1)}</li>
            <li key="translate">Translate: {message?.durations?.translation.toFixed(1)}</li>
          </ul>
        </ListItem>
      </>
    );
  };

  useEffect(() => {
    if (error) {
      console.error(
        "Error fetching thread messages:",
        error.message,
        error.stack,
      );
    }
    if (isLoading) {
      console.log("Fetching thread messages...");
    }
  }, [error, isLoading]);

  if (error) {
    return <div>Error loading thread messages.</div>;
  }

  if (isLoading) {
    return <div>Loading thread messages...</div>;
  }

  return (
    <List>
      {threadMessages?.map((message) => (
        <>
          <ListItem key={message.ts_date + "." + message.ts_time}>
            <ThreadStart message={message} />
          </ListItem>
          {message.content_type == "docs_bot_reply" && botReplyDetails(message)}
        </>
      ))}
    </List>
  );
};

export default ThreadViewPane;
