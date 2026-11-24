/**
 * Adds the persistent state for remote orders.
 * @param {object} data
 * @returns {object}
 */
export function addDroneDeliveriesState(data) {
  if (data.playerState.droneDeliveries !== undefined) return data;
  return {
    ...data,
    playerState: {
      ...data.playerState,
      droneDeliveries: { nextOrderId: 1, activeOrder: null },
    },
  };
}
