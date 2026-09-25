/**
 * Public surface of the calls feature for other features:
 *   useCalls().startCall(chatId, 'audio' | 'video')        (stores/calls)
 *   <OngoingCallBanner chatId={chat.id} />                 (group conversation header)
 *   useActiveCallForChat(chatId)                           (live call + my relation to it)
 *   useMissedCallsCount()                                  (Calls tab badge)
 */
export { OngoingCallBanner } from './OngoingCallBanner';
export {
  markCallsVisited,
  useActiveCallForChat,
  useMissedCallsCount,
  type ChatCallState,
} from './hooks';
