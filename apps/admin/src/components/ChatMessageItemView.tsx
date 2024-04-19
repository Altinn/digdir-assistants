import React, { useEffect } from "react";
import { Button, Box } from "@mui/material";
import { DocsUserQuery, Message, User } from "../models/Models";
import { useUsers } from "../hooks/useUsers";

interface ChatMessageItemViewProps {
  message: Message;
  selectedTeam: string;
  onClick: () => void;
}

const ChatMessageItemView: React.FC<ChatMessageItemViewProps> = ({
  message,
  selectedTeam,
  onClick,
}) => {
  const { data: users, error, isLoading } = useUsers({ selectedTeam });

  useEffect(() => {
    console.log(`Selected team: ${selectedTeam}`);
    console.log(`message.user_id: ${message.user_id}`);
    console.log(`Users.length: ${users?.length}`);
  }, [users, selectedTeam]);

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
        <Box
          display="flex"
          flexDirection="column"
          width="100%"
          style={{ color: "black" }}
        >
          <Box
            display="flex"
            flexDirection="row"
            width="100%"
            justifyContent="space-between"
          >
            <span style={{ fontWeight: "bold" }}>
              {users?.filter((u) => u.user_id == message.user_id)[0]!?.name}
            </span>

            <span style={{ color: "gray" }}>
              {
                new Date(message.ts_date * 1000)
                  .toLocaleDateString("en-US", { day: "2-digit", month: "short" })
                  + ' ' 
                  + new Date(message.ts_date * 1000).toTimeString().slice(0, 5)
              }
            </span>
          </Box>
          <div>{(message.content as DocsUserQuery).original_user_query}</div>
        </Box>
      </Button>
    );
  } catch (error: any) {
    console.error(
      "Error displaying ChatMessageItemView:",
      error.message,
      error.stack,
    );
    return <div>Error displaying message.</div>;
  }
};

export default ChatMessageItemView;
