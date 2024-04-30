import React, { useState } from "react";
import { Link, Box, Tab } from "@mui/material";
import { TabContext, TabList, TabPanel } from "@mui/lab";
import { Message, RagPipelineResult, Reaction } from "../models/Models";

interface BotReplyDetailsProps {
  message: Message;
}

const BotReplyDetails: React.FC<BotReplyDetailsProps> = ({ message }) => {
  const [selectedTab, setSelectedTab] = useState("sources");

  const handleChange = (event: React.ChangeEvent<{}>, newValue: string) => {
    setSelectedTab(newValue);
  };

  if (message?.content_type != "docs_bot_reply") {
    return null;
  }

  const details = message?.content as RagPipelineResult;

  return (
    <TabContext value={selectedTab}>
      <Box sx={{ width: "100%" }}>
        <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
          <TabList onChange={handleChange} aria-label="bot reply details tabs">
            <Tab label="Sources" value="sources" />
            <Tab label="Phrases" value="phrases" />
            <Tab
              label={"Durations (" + message?.durations?.total.toFixed(1) + ")"}
              value="durations"
            />
            <Tab label="Reactions" value="reactions" />
          </TabList>
        </Box>

        <TabPanel value="sources">
          <Box sx={{ flexWrap: "wrap" }}>
            <ul>
              {details?.source_urls.map((url: string, index: number) => (
                <li key={"source_" + index}>
                  <Link href={url} target="_new" rel="noopener noreferrer">
                    {url.replace("https://docs.altinn.studio/", "")}
                  </Link>
                </li>
              ))}
            </ul>
          </Box>
        </TabPanel>

        <TabPanel value="phrases">
          <Box sx={{ flexWrap: "wrap" }}>
            <ul>
              {details?.search_queries.map((query: any, index: number) => (
                <li key={"query" + index}>{query}</li>
              ))}
            </ul>
          </Box>
        </TabPanel>

        <TabPanel value="durations">
          <Box sx={{ flexWrap: "wrap" }}>
            <p style={{ flexBasis: "100%" }}>
              Total: {message?.durations?.total.toFixed(1)}
            </p>
            <ul>
              {Object.entries(message?.durations || {}).map(([key, value]) => (
                <li key={key}>
                  {key.charAt(0).toUpperCase() + key.slice(1).replace("_", " ")}
                  : {value.toFixed(1)}
                </li>
              ))}
            </ul>
          </Box>
        </TabPanel>

        <TabPanel value="reactions">
          <Box sx={{ flexWrap: "wrap" }}>
            <ul>
              {message?.reactions?.map((query: Reaction, index: number) => (
                <li key={query.name}>
                  <pre>
                  {query.name}  ({query.count})
                  </pre>
                </li>
              ))}
            </ul>
          </Box>
        </TabPanel>
      </Box>
    </TabContext>
  );
};

export default BotReplyDetails;
