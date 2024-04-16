import React, { useEffect, useState, useRef } from "react";
import {
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import supabase from "../supabase/SupabaseClient";
import { RealtimeChannel } from "@supabase/supabase-js";

interface Channel {
  channel_id: string;
  name: string;
}

interface Props {
  selectedTeam: string;
  onChannelSelect: (channelId: string) => void;
}

const ChannelList: React.FC<Props> = ({ selectedTeam, onChannelSelect }) => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const channelSubscription = useRef<RealtimeChannel>();

  useEffect(() => {
    const fetchChannels = async () => {
      console.log("Fetching channels for selected team from Supabase...");
      if (!selectedTeam) {
        console.log("No team selected, skipping channel fetch.");
        return;
      }

      const { data, error } = await supabase
        .from("slack_channel")
        .select("channel_id, name")
        .eq("team_id", selectedTeam);

      if (error) {
        console.error("Error fetching channels:", error.message, error.details);
      } else {
        console.log("Channels fetched successfully.");
        setChannels(data);
      }
    };

    fetchChannels();

    // Unsubscribe from any existing subscription before creating a new one
    if (channelSubscription.current) {
      console.log("Removing existing channel subscription.");
      supabase.removeChannel(channelSubscription.current);
    }

    // Subscribe to real-time updates
    console.log("Subscribing to channel updates for selected team.");
    channelSubscription.current = supabase
      .channel("schema-db-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "slack_channel" },
        (payload) => {
          console.log("Channel operation:", JSON.stringify(payload));
        },
      )
      .subscribe();

    return () => {
      if (channelSubscription.current) {
        console.log("Removing channel subscription on component unmount.");
        supabase.removeChannel(channelSubscription.current);
      }
    };
  }, [selectedTeam]);

  const handleChange = (event: React.ChangeEvent<{ value: unknown }>) => {
    const channelId = event.target.value as string;
    console.log(`Channel selected: ${channelId}`);
    setSelectedChannel(channelId);
    onChannelSelect(channelId);
    localStorage.setItem("selectedChannel", channelId);
  };

  return (
    <FormControl fullWidth variant="outlined">
      <InputLabel id="channel-dropdown-label">Channel</InputLabel>
      <Select
        labelId="channel-dropdown-label"
        id="channel-dropdown"
        value={selectedChannel}
        onChange={handleChange}
        label="Channel"
      >
        {channels.map((channel) => (
          <MenuItem key={channel.channel_id} value={channel.channel_id}>
            {channel.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

export default ChannelList;
