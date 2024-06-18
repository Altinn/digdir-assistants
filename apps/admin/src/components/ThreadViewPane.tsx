import React, { useEffect, useState } from "react";
import { Link, List, ListItem, Box, Tab } from "@mui/material";
import { TabContext, TabList, TabPanel } from "@mui/lab";
import { Props, Message } from "../models/Models";
import { useThreadReplies } from "../hooks/useThreadReplies";
import BotReplyContent from "./BotReplyContent";
import BotReplyMetadata from "./BotReplyMetadata";
import RagSourceView from "./RagSourceView";
import RagPromptView from "./RagPromptView";
import { SelectedThreadView } from "../models/Models";

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

  const [currentTab, setCurrentTab] = useState<SelectedThreadView>("original");

  const handleChange = (
    event: React.SyntheticEvent,
    newValue: SelectedThreadView,
  ) => {
    console.log(`Tab changed to: ${newValue}`);
    setCurrentTab(newValue);
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
    <Box sx={{ overflowY: "auto", maxHeight: "calc(100vh - 70px)" }}>
      <TabContext value={currentTab}>
        <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
          <TabList onChange={handleChange} aria-label="view_language">
            <Tab label="English" value="english" />
            <Tab label="Original" value="original" />
            <Tab label="Sources" value="sources" />
            <Tab label="Prompts" value="prompts" />
          </TabList>
        </Box>
        <TabPanel value="english" style={{ padding: "0px 8px" }}>
          <List>
            {threadMessages?.map((message) => (
              <>
                <ListItem>
                  <Box
                    sx={{
                      padding: "20px",
                      background: "lightyellow",
                      border: "1px solid gray",
                    }}
                  >
                    User query:{" "}
                    {threadMessages?.length > 0 &&
                      threadMessages[0].content.english_user_query}
                  </Box>
                </ListItem>
                <ListItem key={message.ts_date + "." + message.ts_time + "_0"}>
                  <BotReplyContent
                    message={message}
                    selectedThreadView={currentTab}
                  />
                </ListItem>
                {message.content_type == "docs_bot_reply" && (
                  <ListItem
                    key={message.ts_date + "." + message.ts_time + "_1"}
                  >
                    <BotReplyMetadata message={message} />
                  </ListItem>
                )}
              </>
            ))}
          </List>
        </TabPanel>
        <TabPanel value="original" style={{ padding: "0px 8px" }}>
          <List>
            {threadMessages?.map((message) => (
              <>
                <ListItem>
                  <Box
                    sx={{
                      padding: "20px",
                      background: "lightyellow",
                      border: "1px solid gray",
                    }}
                  >
                    User query:{" "}
                    {threadMessages?.length > 0 &&
                      threadMessages[0].content.original_user_query}
                  </Box>
                </ListItem>

                <ListItem key={message.ts_date + "." + message.ts_time + "_2"}>
                  <BotReplyContent
                    message={message}
                    selectedThreadView={currentTab}
                  />
                </ListItem>

                {message.content_type == "docs_bot_reply" && (
                  <ListItem
                    key={message.ts_date + "." + message.ts_time + "_3"}
                  >
                    <BotReplyMetadata message={message} />
                  </ListItem>
                )}
              </>
            ))}
          </List>
        </TabPanel>
        <TabPanel value="sources" style={{ padding: "0px 8px" }}>
          {threadMessages && <RagSourceView message={threadMessages[0]} />}
        </TabPanel>
        <TabPanel value="prompts" style={{ padding: "0px 8px" }}>
          {threadMessages && <RagPromptView message={threadMessages[0]} />}
        </TabPanel>
      </TabContext>
    </Box>
  );
};

export default ThreadViewPane;
