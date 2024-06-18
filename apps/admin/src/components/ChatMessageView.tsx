import React, { useEffect } from "react";
import { List, ListItem, Box, useMediaQuery, useTheme } from "@mui/material";
import ThreadViewPane from "./ThreadViewPane";
import ChatMessageItemView from "./ChatMessageItemView";
import { Message } from "../models/Models";
import { useMessages } from "../hooks/useMessages";

interface Props {
  selectedChannel: string;
  selectedTeam: string;
}

const ChatMessageView: React.FC<Props> = ({
  selectedChannel,
  selectedTeam,
}) => {
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const { messages, error, isLoading, setCurrentMessageId, currentMessageId } =
    useMessages(selectedChannel);

  useEffect(() => {
    if (error) {
      console.error("Error fetching messages:", error.message, error.stack);
    }
    if (isLoading) {
      console.log("Fetching messages...");
    }
  }, [selectedChannel, error, isLoading]);

  return (
    <Box display="flex" flexDirection="row" width="100%">
      <List
        id="messageList"
        style={{
          width: isSmallScreen ? "100%" : "50%",
          maxHeight: "calc(100vh - 80px)",
          overflowY: "auto",
        }}
      >
        {messages?.map((message: Message) => (
          <ListItem key={message.ts_date + "." + message.ts_time}>
            {message.content_type === "docs_user_query" && (
              <ChatMessageItemView
                message={message}
                selectedTeam={selectedTeam}
                onClick={() => {
                  setCurrentMessageId({
                    ts_date: message.ts_date,
                    ts_time: message.ts_time,
                  });                  
                }}
              />
            )}
          </ListItem>
        ))}
      </List>
      {currentMessageId && selectedChannel && (
        <Box
          style={{
            width: isSmallScreen ? "100%" : "50%",
            maxHeight: "calc(100vh - 64px)",
            overflowY: "auto",
          }}
        >
          <ThreadViewPane
            channelId={selectedChannel}
            thread_ts_date={currentMessageId?.ts_date || 0}
            thread_ts_time={currentMessageId?.ts_time || 0}
          />
        </Box>
      )}
    </Box>
  );
};

export default ChatMessageView;
