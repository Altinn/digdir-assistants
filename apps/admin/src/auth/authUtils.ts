export const getToken = () => {
  console.log("Retrieving authentication token from local storage.");
  const slackToken = localStorage.getItem("slackToken");
  const authToken = localStorage.getItem("authToken");
  if (slackToken) {
    console.log("Slack token found.");
    return slackToken;
  } else if (authToken) {
    console.log("Auth token found.");
    return authToken;
  } else {
    console.log("No token found.");
    return null;
  }
};

export const isLoggedIn = () => {
  console.log("Checking if user is logged in.");
  const token = getToken();
  if (!token) {
    console.log("No token found, user is not logged in.");
    return false;
  }

  try {
    const session = JSON.parse(token);
    const currentTime = Date.now(); // Use Date.now() for UTC time
    // Check if the 'expires_at' field exists in the session object
    if (!session.expires_at) {
      console.error("Session object does not contain 'expires_at' field.");
      return false;
    }
    // Convert 'expires_at' to UTC if necessary before comparison
    const expiryTime = Date.parse(session.expires_at); // Convert 'expires_at' to a timestamp assuming it's in ISO 8601 format
    if (currentTime > expiryTime) {
      console.log("Token has expired, logging out user.");
      logout();
      return false;
    }
    console.log("User is logged in.");
    return true;
  } catch (error) {
    console.error(
      "Error parsing token from local storage:",
      error.message,
      error.stack,
    );
    return false;
  }
};

export const logout = () => {
  console.log(
    "Logging out user and clearing authentication tokens from local storage.",
  );
  localStorage.removeItem("slackToken");
  localStorage.removeItem("authToken");
  // Redirect to home or login page as needed
  window.location.href = "/";
  console.log("User logged out successfully.");
};
