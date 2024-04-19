import React, { useState, useEffect } from "react";
import "./App.css";
import ChatMessageView from "./components/ChatMessageView";
import Layout from "./components/Layout"; // Importing the Layout component
import TopBar from "./components/TopBar"; // Importing the TopBar component
import supabase from "./supabase/SupabaseClient";

function App() {
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [channels, setChannels] = useState([]); // State for managing channels
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null); // State for managing active channel ID

  useEffect(() => {
    // Fetch channels from the backend or a predefined source
    const fetchChannels = async () => {
      console.log("Fetching channels...");
      const { data, error } = await supabase.from("slack_channel").select("*");
      if (error) {
        console.error("Error fetching channels:", error.message, error.details);
      } else {
        console.log("Channels fetched successfully.");
        setChannels(data);
        setActiveChannelId(data[0]?.id || null);
      }
    };
    fetchChannels();

    // Retrieve the last selected team and channel from localStorage
    const storedSelectedTeam = localStorage.getItem("selectedTeam");
    const storedSelectedChannel = localStorage.getItem("selectedChannel");
    if (storedSelectedTeam) {
      setSelectedTeam(storedSelectedTeam);
    }
    if (storedSelectedChannel) {
      setSelectedChannel(storedSelectedChannel);
    }
  }, []);

  const handleTeamChange = (teamId: string) => {
    console.log(`Team changed to: ${teamId}`);
    setSelectedTeam(teamId);
    // Save the selected team to localStorage
    localStorage.setItem("selectedTeam", teamId);
  };

  const handleChannelSelect = (channelId: string) => {
    console.log(`Channel selected: ${channelId}`);
    setSelectedChannel(channelId);
    // Save the selected channel to localStorage
    localStorage.setItem("selectedChannel", channelId);
    // Find the channel in the channels state to correctly set the activeChannelId
    const activeChannel = channels.find((channel) => channel.id === channelId);
    setActiveChannelId(activeChannel ? activeChannel.id : null);
  };

  console.log("App component rendering...");
  return (
    <>
      <TopBar
        selectedTeam={selectedTeam}
        onTeamChange={handleTeamChange}
        selectedChannel={selectedChannel}
        onChannelSelect={handleChannelSelect}
      />
      <Layout
        channels={channels}
        activeChannelId={activeChannelId}
        mainContent={
          <>
            {selectedChannel && (
              <ChatMessageView
                selectedChannel={selectedChannel}
                selectedTeam={selectedTeam}
              />
            )}
          </>
        }
        sideContent={<div>{/* Side content if needed */}</div>}
      ></Layout>
    </>
  );
}

export default App;
