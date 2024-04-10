import React from "react";
import { Button } from "@mui/material";
import { DocsUserQuery, Message } from "../models/Models";

interface ChatMessageItemViewProps {
  message: Message;
  onClick: () => void;
}

const ChatMessageItemView: React.FC<ChatMessageItemViewProps> = ({
  message,
  onClick,
}) => {
  try {
    return (
      <Button
        onClick={onClick}
        fullWidth
        style={{
          padding: "8px",
          textAlign: "left",
          justifyContent: "start",
          textTransform: "none",
        }}
      >
        <div>
          <div>
            <span style={{ fontWeight: "bold" }}>
              Username: {message.user_name}
            </span>

            <span style={{ color: "gray" }}>
              {new Date(message.ts_date * 1000).toTimeString().slice(0, 5)}
            </span>
          </div>
          <div>{(message.content as DocsUserQuery).original_user_query}</div>
        </div>
      </Button>
    );
  } catch (error) {
    console.error(
      "Error displaying ChatMessageItemView:",
      error.message,
      error.stack,
    );
    return <div>Error displaying message.</div>;
  }
};

export default ChatMessageItemView;
