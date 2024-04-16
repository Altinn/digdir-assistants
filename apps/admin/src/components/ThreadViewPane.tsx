import React, { useEffect } from "react";
import { Link, List, ListItem } from "@mui/material";
import { Props } from "../models/Models";
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

  const botReplyDetails = (message) => {
    if (message?.content_type != "docs_bot_reply") {
      return "";
    }
    const details = message?.content as RagPipelineResult;
    return (
      <>
        <ListItem style={{ flexWrap: "wrap" }}>
          <h5 style={{ flexBasis: "100%" }}>
            Phrases generated for retrieval:
          </h5>
          <ul>{details?.search_queries.map((query) => <li>{query}</li>)}</ul>
        </ListItem>
        <ListItem style={{ flexWrap: "wrap" }}>
          <h5 style={{ flexBasis: "100%" }}>Sources</h5>
          <ul>
            {details?.source_urls.map((url) => (
              <li>
                <Link href={url} target="_new" rel="noopener noreferrer">
                  {url.replace("https://docs.altinn.studio/", "")}
                </Link>
              </li>
            ))}
          </ul>
        </ListItem>
        <ListItem style={{ flexWrap: "wrap" }}>
          <h5 style={{ flexBasis: "100%" }}>Processing times</h5>
          <p style={{ flexBasis: "100%" }}>
            Total: {message?.durations?.total.toFixed(1)}
          </p>
          <ul>
            <li>Analyze: {message?.durations?.analyze.toFixed(1)}</li>
            <li>
              Generate searches:{" "}
              {message?.durations?.generate_searches.toFixed(1)}
            </li>
            <li>
              Phrase similarity:{" "}
              {message?.durations?.phrase_similarity_search.toFixed(1)}
            </li>
            <li>
              Execute searches:{" "}
              {message?.durations?.execute_searches.toFixed(1)}
            </li>
            <li>Re-rank: {message?.durations?.colbert_rerank.toFixed(1)}</li>
            <li>Generate answer: {message?.durations?.rag_query.toFixed(1)}</li>
            <li>Translate: {message?.durations?.translation.toFixed(1)}</li>
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
