import React, { useEffect, useState, useRef } from "react";
import { Select, MenuItem, FormControl, InputLabel } from "@mui/material";
import { useChannels } from "../hooks/useChannels";
import { RealtimeChannel } from "@supabase/supabase-js";
import supabase from "../supabase/SupabaseClient";

interface Channel {
  channel_id: string;
  name: string;
}

interface Props {
  selectedTeam: string;
  onChannelSelect: (channelId: string) => void;
}

const ChannelDropdown: React.FC<Props> = ({
  selectedTeam,
  onChannelSelect,
}) => {
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const channelSubscription = useRef<RealtimeChannel | null>(null);
  const { data: channels, error, isLoading } = useChannels({ selectedTeam });

  useEffect(() => {
    if (channels && channels.length > 0) {
      const storedChannelId = localStorage.getItem("selectedChannel");
      const initialChannelId = storedChannelId || channels[0].channel_id;
      setSelectedChannel(initialChannelId);
      onChannelSelect(initialChannelId);
    }
  }, [channels, onChannelSelect]);

  useEffect(() => {
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
        console.log("Unsubscribing from channel updates.");
        supabase.removeChannel(channelSubscription.current);
        channelSubscription.current = null;
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

  if (error) {
    console.error("Error fetching channels:", error.message, error.stack);
    return <div>Error loading channels.</div>;
  }

  if (isLoading) {
    return <div>Loading channels...</div>;
  }

  return (
    <FormControl variant="outlined">
      <InputLabel id="channel-dropdown-label">Channel</InputLabel>
      <Select
        labelId="channel-dropdown-label"
        id="channel-dropdown"
        value={selectedChannel}
        onChange={handleChange}
        label="Channel"
        style={{ background: "white" }}
      >
        {channels?.map((channel) => (
          <MenuItem key={channel.channel_id} value={channel.channel_id}>
            {channel.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

export default ChannelDropdown;
