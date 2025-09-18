import React from "react";
import { AppBar, Toolbar, Typography, Button } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useNavigate, useLocation } from "react-router-dom";
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
  const navigate = useNavigate();
  const location = useLocation();

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
        <Button
          color="inherit"
          onClick={() => navigate('/')}
          variant={location.pathname === '/' ? 'outlined' : 'text'}
        >
          Chat
        </Button>
        <Button
          color="inherit"
          onClick={() => navigate('/dashboard')}
          variant={location.pathname === '/dashboard' ? 'outlined' : 'text'}
        >
          Dashboard
        </Button>
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
