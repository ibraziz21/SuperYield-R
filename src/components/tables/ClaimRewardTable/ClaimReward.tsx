"use client";

import React from "react";
import ClaimRewardTable from ".";
import { ClaimableRewardColumns, ClaimableReward } from "./columns";

const ClaimRewards = () => {
  // Dummy data for demonstration
  const claimableRewardsSource: ClaimableReward[] = [
    {
      network: "Ethereum",
      source: "Aave V3",
      claimable: "125.50",
      token: "AAVE",
    },
    {
      network: "Lisk",
      source: "Morpho Blue",
      claimable: "2,340.00",
      token: "USDC",
    },
    {
      network: "Ethereum",
      source: "Compound",
      claimable: "0.045",
      token: "ETH",
    },
    {
      network: "Arbitrum",
      source: "GMX",
      claimable: "89.30",
      token: "GMX",
    },
    {
      network: "Lisk",
      source: "Morpho Blue",
      claimable: "1.25",
      token: "WETH",
    },
  ];

  const generateTblData = (item: ClaimableReward): ClaimableReward => {
    return {
      network: item.network,
      source: item.source,
      claimable: item.claimable,
      token: item.token,
    };
  };

  const tableData = Array.isArray(claimableRewardsSource)
    ? claimableRewardsSource.map((element) => generateTblData(element))
    : [];

  return <ClaimRewardTable columns={ClaimableRewardColumns} data={tableData} />;
};

export default ClaimRewards;
