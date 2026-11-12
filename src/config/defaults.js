// Default chat replies. .env.example and the setup wizard are generated from
// this file, and a test fails if they drift.
//
// Placeholders: {player} {master} {type} {status} {seconds} {x} {y} {z}
// {health} {food} {coordinates}
module.exports = {
  BLACKLIST_MESSAGE: "You are not allowed to use this bot, {player}.",
  RATE_LIMITED_MESSAGE: "Slow down, {player}. Try again in a moment.",
  MASTER_ONLY_MESSAGE: "{player}, only a master can use that command.",
  MASTER_PROTECTED_MESSAGE: "The primary master, {master}, cannot be removed.",
  MASTER_JOIN_MESSAGE: "Welcome, my master.",
  MASTER_LEAVE_MESSAGE: "Goodbye, my master.",
  MASTER_USAGE_MESSAGE: "Usage: !master <username>",
  RM_MASTER_USAGE_MESSAGE: "Usage: !rm master <username>",
  ALREADY_MASTER_MESSAGE: "{player} is already a master.",
  MASTER_ADDED_MESSAGE: "{player} is now a master.",
  NOT_SECONDARY_MASTER_MESSAGE: "{player} is not a secondary master.",
  MASTER_REMOVED_MESSAGE: "{player} is no longer a master.",
  BLACKLIST_USAGE_MESSAGE: "Usage: !bl <username>",
  RM_BLACKLIST_USAGE_MESSAGE: "Usage: !rmbl <username>",
  PRIMARY_MASTER_BLACKLIST_MESSAGE: "The primary master cannot be blacklisted.",
  ALREADY_BLACKLISTED_MESSAGE: "{player} is already blacklisted.",
  BLACKLISTED_MESSAGE: "{player} has been blacklisted.",
  NOT_BLACKLISTED_MESSAGE: "{player} is not blacklisted.",
  UNBLACKLISTED_MESSAGE: "{player} has been removed from the blacklist.",
  UNKNOWN_MASTER_COMMAND_MESSAGE: "Unknown master command.",
  PUBLIC_ACCESS_MESSAGE: "Bot access is now public.",
  PRIVATE_ACCESS_MESSAGE:
    "Bot access is now private. Only masters may use bot commands, and teleport requests require master approval.",
  TPA_USAGE_MESSAGE: "Usage: !tpa <on|off>",
  TPA_STATUS_MESSAGE: "Teleport requests are now {status}.",
  TELEPORT_APPROVAL_MESSAGE:
    "Teleport request from {player} ({type}) needs master approval. A master should reply !y or !n.",
  TELEPORT_ACCEPTED_MESSAGE: "Accepted {type} from {player}.",
  TELEPORT_REJECTED_MESSAGE:
    "My master does not allow me to accept your request, {player}.",
  TELEPORT_EXPIRED_MESSAGE: "The {type} request from {player} expired.",
  TELEPORT_COOLDOWN_MESSAGE:
    "One moment, {player}. I am busy with another teleport request.",
  TELEPORT_QUEUE_FULL_MESSAGE:
    "Too many pending teleport requests, {player}. Try again later.",
  TELEPORT_AUTO_ACCEPT_MESSAGE: "Accepted {type} from {player}.",
  TELEPORT_NONE_MESSAGE: "There is no pending teleport request.",
  NAVIGATION_DISABLED_MESSAGE: "Navigation is disabled on this bot.",
  STATUS_MESSAGE: "Online for {seconds}s at {x} {y} {z} (health {health}/20).",
  POS_MESSAGE: "I am at {x} {y} {z}.",
  HEALTH_MESSAGE: "Health {health}/20, food {food}/20.",
  SAY_USAGE_MESSAGE: "Usage: !say <text>",
  PRIMARY_STOP_ONLY_MESSAGE:
    "{player}, only the primary master can stop the bot.",
  STOP_MESSAGE: "Stopping AFK bot.",
  FOLLOWING_MESSAGE: "Following {player}.",
  FOLLOW_TARGET_NOT_FOUND_MESSAGE:
    "I cannot see you, {player}. Try !come x y z for a one-time destination.",
  COMING_COORDINATES_MESSAGE: "Coming to {coordinates}.",
  COMING_PLAYER_MESSAGE: "Coming to {player}.",
  COME_TARGET_NOT_FOUND_MESSAGE:
    "I cannot see you, {player}. Send !come x y z with your coordinates.",
  COME_COORDINATES_INVALID_MESSAGE:
    "{player}, those coordinates are out of range. Use !come x y z.",
  GOAL_REACHED_MESSAGE: "I reached the coordinates.",
  NAVIGATION_GAVE_UP_MESSAGE:
    "I could not find a way there, so I stopped trying.",
  NAVIGATION_STOPPED_MESSAGE: "Stopped following and navigation.",
  NAVIGATION_TARGET_LEFT_MESSAGE:
    "{player} left the server, so navigation was stopped.",
  NOT_FOLLOWING_MESSAGE: "{player}, I am not following anyone.",
};
