import React, { useEffect } from "react";
import { Button, Box } from "@mui/material";
import { DocsUserQuery, Message, User } from "../models/Models";
import { useUsers } from "../hooks/useUsers";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCopy } from "@fortawesome/free-solid-svg-icons";

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
      <Box
        onClick={onClick}
        width="100%"
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
            <span style={{ color: "gray" }}>
              {users?.filter((u) => u.user_id == message.user_id)[0]!?.name}
            </span>

            <Box>
              <Button
                onClick={() =>
                  navigator.clipboard.writeText(
                    message.content.original_user_query,
                  )
                }
                className="copy-query"
                size="small"
                sx={{
                  color: "#EEEEEE",
                  minWidth: 0,
                  padding: 0,
                  marginRight: 1,
                }}
              >
                <FontAwesomeIcon icon={faCopy} />
              </Button>
              <span style={{ color: "gray" }}>
                {new Date(message.ts_date * 1000).toTimeString().slice(0, 5) +
                  " " +
                  new Date(message.ts_date * 1000).toLocaleDateString("en-US", {
                    day: "2-digit",
                    month: "short",
                  })}
              </span>
            </Box>
          </Box>
          <Box>{(message.content as DocsUserQuery).original_user_query}</Box>
        </Box>
      </Box>
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
