import React from "react";
import { rootClient } from "@rootsdk/client-app";
import { cachedName, cachedProfile } from "../users";

/**
 * A member as Root shows them: profile photo, then the name in their role's
 * color. A click opens their Root profile. Names load with loadNames first.
 */
const UserName: React.FC<{ id: string; photo?: boolean }> = ({ id, photo = true }) => {
  const profile = cachedProfile(id);
  const name = cachedName(id);
  return (
    <button type="button" className="user-name" onClick={(e) => (e.stopPropagation(), rootClient.users.showUserProfile(id))}>
      {photo &&
        (profile?.picture ? (
          <img className="user-photo" src={profile.picture} alt="" />
        ) : (
          <span className="user-photo" aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
        ))}
      <span className="user-label" style={profile?.color ? { color: profile.color } : undefined}>
        {name}
      </span>
    </button>
  );
};

/** A translated sentence with a member in it: the text is built with "\u0001" in the name's place. */
export function withUser(text: string, id: string): React.ReactNode {
  const [before, after = ""] = text.split("\u0001");
  return (
    <>
      {before}
      <UserName id={id} photo={false} />
      {after}
    </>
  );
}

export default UserName;
