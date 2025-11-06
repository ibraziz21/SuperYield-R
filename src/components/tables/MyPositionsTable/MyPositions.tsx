"use client";

import React from "react";
import MyPositionsTable from ".";
import { MyPositionsColumns, Position } from "./columns";

const MyPositions = () => {
  // Dummy data for demonstration
  const positionsSource: Position[] = [
    {
      vault: "USDC",
      network: "Ethereum",
      deposits: "25,430.50",
      protocol: "Morpho Blue",
      apy: "4.85",
    },
    {
      vault: "USDT0",
      network: "Lisk",
      deposits: "12,850.00",
      protocol: "Morpho Blue",
      apy: "3.42",
    },
    {
      vault: "USDT",
      network: "Arbitrum",
      deposits: "8,920.75",
      protocol: "Morpho Blue",
      apy: "5.12",
    },
    {
      vault: "USDT",
      network: "Optimism",
      deposits: "15,600.00",
      protocol: "Morpho Blue",
      apy: "6.28",
    },
  ];

  const generateTblData = (item: Position): Position => {
    return {
      vault: item.vault,
      network: item.network,
      deposits: item.deposits,
      protocol: item.protocol,
      apy: item.apy,
    };
  };

  const tableData = Array.isArray(positionsSource)
    ? positionsSource.map((element) => generateTblData(element))
    : [];

  return <MyPositionsTable columns={MyPositionsColumns} data={tableData} />;
};

export default MyPositions;
