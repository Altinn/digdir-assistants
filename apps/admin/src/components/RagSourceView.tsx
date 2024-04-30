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
            {message?.content?.source_documents?.map(
              (docObj: object, index: number) => (
                <li>
                  <Box flexDirection="column">
                    <span>
                      Result #{index + 1}:&nbsp;
                      <Link
                        href={message.content?.source_urls[index]}
                        target="_new"
                        rel="noopener noreferrer"
                      >
                        {message.content?.source_urls[index].replace(
                          "https://docs.altinn.studio/",
                          "",
                        )}
                      </Link>
                    </span>
                    <ReactMarkdown components={components}>
                      {docObj.page_content}
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
