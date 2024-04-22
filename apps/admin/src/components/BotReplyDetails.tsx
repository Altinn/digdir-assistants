import React, { useState } from "react";
import { ListItem, Link, Box, Tab } from "@mui/material";
import { TabContext, TabList, TabPanel } from "@mui/lab";
import { Message, RagPipelineResult } from "../models/Models";

interface BotReplyDetailsProps {
  message: Message;
}

const BotReplyDetails: React.FC<BotReplyDetailsProps> = ({ message }) => {
  const [selectedTab, setSelectedTab] = useState(0);

  const handleChange = (event: React.ChangeEvent<{}>, newValue: number) => {
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
          <TabList
            value={selectedTab}
            onChange={handleChange}
            aria-label="bot reply details tabs"
          >
            <Tab label="Sources" />
            <Tab label="Phrases" />
            <Tab label="Processing times" />
          </TabList>
        </Box>
        {selectedTab === 0 && (
          <ListItem style={{ flexWrap: "wrap" }}>
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
        )}
        {selectedTab === 1 && (
          <ListItem style={{ flexWrap: "wrap" }}>
            <h5 style={{ flexBasis: "100%" }}>
              Phrases generated for retrieval:
            </h5>
            <ul>
              {details?.search_queries.map((query: any, index: number) => (
                <li key={index}>{query}</li>
              ))}
            </ul>
          </ListItem>
        )}
        
        {selectedTab === 2 && (
          <ListItem style={{ flexWrap: "wrap" }}>
            <h5 style={{ flexBasis: "100%" }}>Processing times</h5>
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
          </ListItem>
        )}
      </Box>
    </TabContext>
  );
};

export default BotReplyDetails;
