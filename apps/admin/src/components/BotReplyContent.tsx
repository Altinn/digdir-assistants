import React, { useState } from "react";
import { ListItemText } from "@mui/material";
import ReactMarkdown from "react-markdown";
import { LightAsync as SyntaxHighlighter } from "react-syntax-highlighter";
import { github } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { DocsBotReplyMessage, DocsUserQueryMessage, SelectedThreadView } from "../models/Models";

export type Params = (DocsBotReplyMessage | DocsUserQueryMessage) & {
  selectedThreadView: SelectedThreadView;
};

const BotReplyContent: React.FC<Params> = ({ message, selectedThreadView }) => {
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
    return params.selectedThreadView == "original" &&
      "translated_answer" in params.message.content
      ? params.message.content.translated_answer
      : params.message.content.english_answer;
  };

  return (
    <ListItemText>
      <ReactMarkdown components={components}>
        {conditionalContent({ message, selectedThreadView })}
      </ReactMarkdown>
    </ListItemText>
  );
};

export default BotReplyContent;
