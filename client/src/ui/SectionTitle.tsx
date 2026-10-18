import React from "react";

/** A Settings card's heading: an icon in a tinted tile, the title, and an optional line under it. */
const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <h2 className="section-title">
    <span className="section-icon">{icon}</span>
    <span className="section-text">{children}</span>
  </h2>
);

export default SectionTitle;
