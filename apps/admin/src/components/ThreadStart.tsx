import React, { useState } from "react";
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

enum DisplayLanguage {
  English = "english",
  Original = "original",
}

export type Params = (DocsBotReplyMessage | DocsUserQueryMessage) & {
  displayLanguage: DisplayLanguage;
};

const ThreadStart: React.FC<Params> = ({ message, displayLanguage }) => {
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

  const conditionalContent = (params: Params) => {
    return params.displayLanguage == "original" &&
      "translated_answer" in params.message.content
      ? params.message.content.translated_answer
      : params.message.content.english_answer;
  };

  return (
    <ListItemText>
      <ReactMarkdown components={components}>
        {conditionalContent({message, displayLanguage})}        
      </ReactMarkdown>
    </ListItemText>
  );
};

export default ThreadStart;
