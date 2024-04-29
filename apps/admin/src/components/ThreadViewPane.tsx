import React, { useEffect, useState } from "react";
import { Link, List, ListItem, Box, Tab } from "@mui/material";
import { TabContext, TabList, TabPanel } from "@mui/lab";
import { Props, Message } from "../models/Models";
import { useThreadReplies } from "../hooks/useThreadReplies";
import { RagPipelineResult } from "@digdir/assistants";
import BotReplyContent from "./BotReplyContent";
import BotReplyMetadata from "./BotReplyMetadata";
import RagSourceView from "./RagSourceView";

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

  const [currentTab, setCurrentTab] = useState("original");

  const handleChange = (event: React.SyntheticEvent, newValue: string) => {
    console.log(`Tab changed to: ${newValue}`);
    setCurrentTab(newValue);
  };

  useEffect(() => {
    if (error) {
      console.error(
        "Error fetching thread messages:",
        error.message,
        error.stack
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
    <Box sx={{ overflowY: "auto", maxHeight: "calc(100vh - 70px)" }}>
      <TabContext value={currentTab}>
        <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
          <TabList onChange={handleChange} aria-label="view_language">
            <Tab label="English" value="english" />
            <Tab label="Original" value="original" />
            <Tab label="Sources" value="sources" />
          </TabList>
        </Box>
        <TabPanel value="english">
          <List>
            {threadMessages?.map((message) => (
              <>
                <ListItem key={message.ts_date + "." + message.ts_time + "_0"}>
                  <BotReplyContent
                    message={message}
                    displayLanguage={currentTab}
                  />
                </ListItem>
                {message.content_type == "docs_bot_reply" && (
                  <BotReplyMetadata message={message} />
                )}
              </>
            ))}
          </List>
        </TabPanel>
        <TabPanel value="original">
          <List>
            {threadMessages?.map((message) => (
              <>
                <ListItem key={message.ts_date + "." + message.ts_time + "_0"}>
                  <BotReplyContent
                    message={message}
                    displayLanguage={currentTab}
                  />
                </ListItem>
                {message.content_type == "docs_bot_reply" && (
                  <BotReplyMetadata message={message} />
                )}
              </>
            ))}
          </List>
        </TabPanel>
        <TabPanel value="sources">
          <RagSourceView message={threadMessages[0]} />
        </TabPanel>
      </TabContext>
    </Box>
  );
};

export default ThreadViewPane;
