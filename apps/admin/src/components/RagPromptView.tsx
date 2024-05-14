import React from "react";
import { Link, Box } from "@mui/material";
import ReactMarkdown from "react-markdown";
import { LightAsync as SyntaxHighlighter } from "react-syntax-highlighter";
import { github } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { DocsBotReplyMessage } from "../models/Models";
import ErrorBoundary from "./ErrorBoundary";

export type Params = DocsBotReplyMessage & {};

const RagSourceView: React.FC<Params> = ({ message }) => {
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
    <Box sx={{ flexWrap: "wrap" }}>
      <React.Fragment>
        <ErrorBoundary>
          {" "}
          <ul>
            {Object.entries(message?.content?.prompts || {}).map(
              ([key, value], index) => (
                <li key={key}>
                  <Box flexDirection="column">
                    <span>
                      Prompt #{index + 1}: {key}
                    </span>
                    <ReactMarkdown components={components}>
                      {value}
                    </ReactMarkdown>
                  </Box>
                  <hr />
                </li>
              ),
            )}
          </ul>
        </ErrorBoundary>
      </React.Fragment>
    </Box>
  );
};

export default RagSourceView;
