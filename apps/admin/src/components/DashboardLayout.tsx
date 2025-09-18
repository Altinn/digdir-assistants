import React from "react";
import TopBar from "./TopBar";
import Layout from "./Layout";
import Dashboard from "./Dashboard";

function DashboardLayout() {
  return (
    <>
      <TopBar
        selectedTeam=""
        onTeamChange={() => {}}
        selectedChannel=""
        onChannelSelect={() => {}}
      />
      <Layout
        channels={[]}
        activeChannelId={null}
        mainContent={<Dashboard />}
        sideContent={<div />}
      />
    </>
  );
}

export default DashboardLayout;