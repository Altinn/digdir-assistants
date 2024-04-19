import React from "react";
import { AppBar, Toolbar, Typography, Button } from "@mui/material";
import { styled } from "@mui/material/styles";
import TeamSelectionDropdown from "./TeamSelectionDropdown";
import ChannelDropdown from "./ChannelDropdown";
import { logout } from "../auth/authUtils"; // Import the logout function

const StyledAppBar = styled(AppBar)(({ theme }) => ({
  zIndex: theme.zIndex.drawer + 1,
}));

interface TopBarProps {
  selectedTeam: string;
  onTeamChange: (teamId: string) => void;
  selectedChannel: string;
  onChannelSelect: (channelId: string) => void;
}

const TopBar: React.FC<TopBarProps> = ({
  selectedTeam,
  onTeamChange,
  onChannelSelect,
}) => {
  const handleLogout = () => {
    console.log("Logging out user.");
    try {
      logout();
      console.log("User logged out successfully.");
    } catch (error) {
      console.error("Error logging out user:", error.message, error.stack);
    }
  };

  return (
    <StyledAppBar position="fixed">
      <Toolbar sx={{ gap: "30px" }}>
        <Typography variant="h6" noWrap component="div">
          Digdir Assistants
        </Typography>
        <TeamSelectionDropdown onTeamChange={onTeamChange} />
        {selectedTeam && (
          <ChannelDropdown
            selectedTeam={selectedTeam}
            onChannelSelect={onChannelSelect}
          />
        )}
        <Button color="inherit" onClick={handleLogout}>
          Logout
        </Button>
      </Toolbar>
    </StyledAppBar>
  );
};

export default TopBar;
