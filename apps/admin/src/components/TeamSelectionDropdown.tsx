import React, { useEffect, useState } from "react";
import {
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  useMediaQuery,
} from "@mui/material";
import { useTeams } from "../hooks/useTeams";

interface Team {
  team_id: string;
  name: string;
}

interface Props {
  onTeamChange: (teamId: string) => void;
}

const TeamSelectionDropdown: React.FC<Props> = ({ onTeamChange }) => {
  const [selectedTeam, setSelectedTeam] = useState("");
  const matches = useMediaQuery("(max-width:768px)");
  const { data: teams, error, isLoading } = useTeams();

  useEffect(() => {
    if (!isLoading && teams && teams.length > 0) {
      const storedSelectedTeam = localStorage.getItem("selectedTeam");
      if (
        storedSelectedTeam &&
        teams.some((team) => team.team_id === storedSelectedTeam)
      ) {
        console.log(
          `Restoring previously selected team: ${storedSelectedTeam}`,
        );
        setSelectedTeam(storedSelectedTeam);
        onTeamChange(storedSelectedTeam);
      } else {
        console.log(`Setting default team as: ${teams[0].team_id}`);
        setSelectedTeam(teams[0].team_id);
        onTeamChange(teams[0].team_id);
        localStorage.setItem("selectedTeam", teams[0].team_id);
      }
    }
  }, [teams, isLoading, onTeamChange]);

  const handleChange = (event: React.ChangeEvent<{ value: string }>) => {
    const teamId = event.target.value as string;
    console.log(`Team selected: ${teamId}`);
    setSelectedTeam(teamId);
    onTeamChange(teamId);
    localStorage.setItem("selectedTeam", teamId);
  };

  if (error) {
    console.error("Error fetching teams:", error.message, error.stack);
    return <div>Error loading teams.</div>;
  }

  if (isLoading) {
    return <div>Loading teams...</div>;
  }

  return (
    <FormControl variant={matches ? "standard" : "outlined"}>
      <InputLabel id="team-selection-label">Select a Team</InputLabel>
      <Select
        labelId="team-selection-label"
        id="team-selection"
        value={selectedTeam}
        label="Select a Team"
        style={{ background: "white" }}
        onChange={handleChange}
      >
        {teams.map((team) => (
          <MenuItem key={team.team_id} value={team.team_id}>
            {team.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

export default TeamSelectionDropdown;
