import React from "react";
import { ListItemText } from "@mui/material";
import ReactMarkdown from "react-markdown";
import { LightAsync as SyntaxHighlighter } from "react-syntax-highlighter";
import { github } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { RagPipelineResult, Message, DocsUserQuery } from "../models/Models";

export interface DocsUserQueryMessage {
  message: Message & {
    content: DocsUserQuery;
  };
}

export interface DocsBotReplyMessage {
  message: Message & {
    content: RagPipelineResult;
  };
}

const ThreadStart: React.FC<DocsBotReplyMessage | DocsUserQueryMessage> = ({
  message,
}) => {
  const components = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      return !inline && match ? (
        <SyntaxHighlighter
          children={String(children).replace(/\n$/, "")}
          style={github}
          language={match[1]}
          PreTag="div"
          {...props}
        />
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  };

  return (
    <ListItemText>
      <ReactMarkdown components={components}>
        {"content" in message && "english_answer" in message.content
          ? message.content.english_answer
          : ""}
      </ReactMarkdown>
    </ListItemText>
  );
};

export default ThreadStart;
