import React from "react";

interface LayoutProps {
  channels: any[];
  activeChannelId: string | null;
  mainContent: React.ReactNode;
  sideContent: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({
  channels,
  activeChannelId,
  mainContent,
  sideContent,
}) => {
  return (
    <div className="appContainer">
      <main className="content">{mainContent}</main>
    </div>
  );
};

export default Layout;
