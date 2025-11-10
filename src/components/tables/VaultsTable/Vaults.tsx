// src/components/tables/VaultsTable/Vaults.tsx
"use client";

import React from "react";
import VaultsTable from ".";
import { VaultsColumns } from "./columns";
import { vaultsData } from "@/lib/vaultsData";

const Vaults: React.FC = () => {
  return <VaultsTable columns={VaultsColumns} data={vaultsData} />;
};

export default Vaults;
