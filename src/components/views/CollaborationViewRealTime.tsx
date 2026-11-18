import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageSquare,
  BookOpen,
  FolderKanban,
  Video,
  Hash,
  Plus,
  Search,
  Pin,
  Lock,
  Globe,
  Users,
  Radio,
  Download,
  Tag,
  Paperclip,
  Share2,
  Loader2,
  AlertCircle,
  WifiOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  UserRole,
  ChannelRecord,
  MessageRecord,
  ThreadReplyRecord,
  WorkspaceFile,
  SharedNoteRecord,
  HuddleSessionRecord,
} from '@/types';

import { MessageList } from '@/components/collaboration/MessageList';
import { MessageComposer } from '@/components/collaboration/MessageComposer';
import { ThreadDrawer } from '@/components/collaboration/ThreadDrawer';
import { CreateChannelModal } from '@/components/collaboration/CreateChannelModal';
import { WorkspaceFilesView } from '@/components/collaboration/WorkspaceFilesView';
import { SharedNotesView } from '@/components/collaboration/SharedNotesView';
import { HuddleModal } from '@/components/collaboration/HuddleModal';

import { useCollaboration } from '@/hooks/useCollaboration';
import { apiClient } from '@/services/api/apiClient';
import { socketClient, type MessageData as RealtimeMessageData } from '@/services/realtime/SocketClient';

interface CollaborationViewRealTimeProps {
  userFullName: string;
  userRole: UserRole;
  userId?: string;
  currentPath?: string;
  onNavigate?: (path: string) => void;
}

type CollaborationTab = 'chat' | 'notes' | 'files';

export function CollaborationViewRealTime({
  userFullName,
  userRole,
  userId = 'usr_super_admin',
  currentPath = '/collaboration',
  onNavigate,
}: CollaborationViewRealTimeProps) {
  // Use the new real-time collaboration hook
  const {
    connected,
    connecting,
    connectionError,
    channels,
    activeChannelId,
    setActiveChannel,
    createChannel,
    messages,
    loadingMessages,
    hasMoreMessages,
    loadMoreMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    pinMessage,
    unpinMessage,
    addReaction,
    removeReaction,
    openThread,
    closeThread,
    activeThreadMessage,
    threadReplies,
    sendThreadReply,
    typingUsers,
    presence,
    unreadCounts,
    notifications,
    unreadNotificationCount,
  } = useCollaboration(userId, '', userFullName, userRole);

  // Local state for modals and UI
  const [channelSearch, setChannelSearch] = useState('');
  const [filterPinnedOnly, setFilterPinnedOnly] = useState(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [isHuddleOpen, setIsHuddleOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<CollaborationTab>(() => {
    if (currentPath.includes('/notes')) return 'notes';
    if (currentPath.includes('/files')) return 'files';
    return 'chat';
  });

  // Sync tab with external currentPath changes
  useEffect(() => {
    if (currentPath.includes('/notes')) setActiveTab('notes');
    else if (currentPath.includes('/files')) setActiveTab('files');
    else setActiveTab('chat');
  }, [currentPath]);

  const handleTabChange = (tab: CollaborationTab) => {
    setActiveTab(tab);
    if (onNavigate) {
      if (tab === 'chat') onNavigate('/collaboration');
      if (tab === 'notes') onNavigate('/collaboration/notes');
      if (tab === 'files') onNavigate('/collaboration/files');
    }
  };

  const activeChannel = channels.find(c => c.id === activeChannelId) || channels[0];

  const filteredChannels = channels.filter(c =>
    c.name.toLowerCase().includes(channelSearch.toLowerCase())
  );

  const currentChannelMessages = messages.filter(m => {
    const isChannel = m.channelId === activeChannelId;
    if (filterPinnedOnly) return isChannel && m.isPinned;
    return isChannel;
  });

  const activeThreadReplies = activeThreadMessage
    ? threadReplies
    : [];

  // Load channels on mount
  useEffect(() => {
    const loadChannels = async () => {
      try {
        const response = await apiClient.getChannels({ limit: 100 });
        // The hook will handle channel updates via socket events
        // But we need initial load - this is a placeholder
        // In a full implementation, you'd update the hook's channel state
      } catch (err) {
        console.error('Failed to load channels:', err);
      }
    };
    loadChannels();
  }, []);

  // Handle create channel
  const handleCreateChannel = async (newChannel: ChannelRecord) => {
    try {
      const response = await apiClient.createChannel({
        name: newChannel.name,
        description: newChannel.description,
        topic: newChannel.topic,
        isPrivate: newChannel.isPrivate,
      });
      // The socket event will handle adding to the list
      setActiveChannel(response.data.id);
    } catch (err) {
      console.error('Create channel failed:', err);
    }
  };

  // Handle send message
  const handleSendMessage = (content: string, attachments?: WorkspaceFile[]) => {
    if (!activeChannelId) return;
    sendMessage(content, { parentId: undefined });
  };

  // Handle thread reply
  const handleSendThreadReply = (content: string) => {
    if (!activeThreadMessage) return;
    sendThreadReply(content);
  };

  // Handle open thread
  const handleOpenThread = (message: MessageRecord) => {
    // Adapt MessageRecord to RealtimeMessageData shape for the hook
    openThread(message as unknown as RealtimeMessageData);
  };

  // Toggle reaction
  const handleToggleReaction = (messageId: string, emoji: string) => {
    // Check if user already reacted
    const message = messages.find(m => m.id === messageId);
    if (!message) return;
    
    const reaction = message.reactions?.find(r => r.emoji === emoji);
    const hasReacted = reaction?.users?.includes(userFullName);
    
    if (hasReacted) {
      removeReaction(messageId, emoji);
    } else {
      addReaction(messageId, emoji);
    }
  };

  // Toggle pin
  const handleTogglePin = (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message) return;
    
    if (message.isPinned) {
      unpinMessage(messageId);
    } else {
      pinMessage(messageId);
    }
  };

  // Handle file upload
  const handleUploadFile = (newFile: WorkspaceFile) => {
    // This would integrate with the attachment upload API
    console.log('Upload file:', newFile);
  };

  // Handle delete file
  const handleDeleteFile = (fileId: string) => {
    console.log('Delete file:', fileId);
  };

  // Handle create note
  const handleCreateNote = (newNote: SharedNoteRecord) => {
    console.log('Create note:', newNote);
  };

  // Handle update note
  const handleUpdateNote = (noteId: string, updates: Partial<SharedNoteRecord>) => {
    console.log('Update note:', noteId, updates);
  };

  // Handle delete note
  const handleDeleteNote = (noteId: string) => {
    console.log('Delete note:', noteId);
  };

  // Huddle notes sync
  const handleUpdateHuddleNotes = (notesText: string) => {
    console.log('Update huddle notes:', notesText);
  };

  // Typing handlers for MessageComposer
  const handleTypingStart = () => {
    if (activeChannelId) {
      socketClient.typingStart({ channelId: activeChannelId });
    }
  };

  const handleTypingStop = () => {
    if (activeChannelId) {
      socketClient.typingStop({ channelId: activeChannelId });
    }
  };

  // Connection status display
  const getConnectionStatus = () => {
    if (connecting) return { label: 'Connecting...', color: 'text-yellow-600', icon: <Loader2 className="animate-spin" size={12} /> };
    if (connectionError) return { label: 'Connection Error', color: 'text-red-600', icon: <AlertCircle size={12} /> };
    if (connected) return { label: 'Connected', color: 'text-emerald-600', icon: <Radio size={12} /> };
    return { label: 'Disconnected', color: 'text-slate-400', icon: <WifiOff size={12} /> };
  };

  const connectionStatus = getConnectionStatus();

  return (
    <div className="space-y-5">
      {/* Top Workspace Collaboration Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#D8E2EC] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-[#0F172A] flex items-center gap-2">
              <MessageSquare className="text-[#E03616]" size={22} />
              Team Collaboration Engine
            </h1>
            <Badge variant="slateBlue">Phase 2 Real-Time</Badge>
          </div>
          <p className="mt-0.5 text-xs text-[#54657E]">
            Channels, real-time message threads, Living Notes with CRM/ERP lineage, encrypted files vault, and demonstration huddles.
          </p>
        </div>

        {/* Connection Status & Global Actions */}
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${connectionStatus.color} bg-white/80 border border-current/20 text-xs font-medium`}>
            {connectionStatus.icon}
            <span>{connectionStatus.label}</span>
          </div>
          
          <button
            type="button"
            onClick={() => setIsHuddleOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#E03616] text-white hover:bg-[#C72E14] text-xs font-bold transition-all shadow-xs cursor-pointer group"
            disabled={!connected}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
            </span>
            <Video size={14} />
            <span>Join Huddle (#{activeChannel?.name || 'general'})</span>
          </button>
        </div>
      </div>

      {/* Primary Sub-Tabs Navigation */}
      <div className="flex items-center justify-between border-b border-[#D8E2EC] bg-white px-2 py-1.5 rounded-xl shadow-xs">
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => handleTabChange('chat')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${activeTab === 'chat' ? 'bg-[#1B2436] text-white shadow-xs' : 'text-[#54657E] hover:text-[#0F172A] hover:bg-[#F0F4F8]'}`}
          >
            <MessageSquare size={14} className={activeTab === 'chat' ? 'text-[#E03616]' : ''} />
            <span>Channels & Messages</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${activeTab === 'chat' ? 'bg-[#27334D] text-white' : 'bg-[#E8EEF5] text-[#1B2436]'}`}>
              {channels.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('notes')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${activeTab === 'notes' ? 'bg-[#1B2436] text-white shadow-xs' : 'text-[#54657E] hover:text-[#0F172A] hover:bg-[#F0F4F8]'}`}
          >
            <BookOpen size={14} className={activeTab === 'notes' ? 'text-[#E03616]' : ''} />
            <span>Living Notes & Docs</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${activeTab === 'notes' ? 'bg-[#27334D] text-white' : 'bg-[#E8EEF5] text-[#1B2436]'}`}>
              0
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('files')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${activeTab === 'files' ? 'bg-[#1B2436] text-white shadow-xs' : 'text-[#54657E] hover:text-[#0F172A] hover:bg-[#F0F4F8]'}`}
          >
            <FolderKanban size={14} className={activeTab === 'files' ? 'text-[#E03616]' : ''} />
            <span>Workspace Files & Vault</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${activeTab === 'files' ? 'bg-[#27334D] text-white' : 'bg-[#E8EEF5] text-[#1B2436]'}`}>
              0
            </span>
          </button>
        </div>

        {/* Typing indicator */}
        {activeChannelId && (typingUsers.get(activeChannelId)?.length ?? 0) > 0 && (
          <div className="hidden md:flex items-center gap-2 text-[11px] text-[#E03616] font-mono pr-2 animate-pulse">
            <span>Typing: {typingUsers.get(activeChannelId)?.join(', ')}</span>
          </div>
        )}
      </div>

      {/* Tab 1: Channels & Messages Core */}
      {activeTab === 'chat' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-0 rounded-2xl border border-[#D8E2EC] bg-white overflow-hidden shadow-xs min-h-[620px]">
          {/* Left Column - Channel Sidebar */}
          <div className="md:col-span-4 lg:col-span-3 border-r border-[#243048] bg-[#1B2436] p-3 flex flex-col justify-between text-slate-200">
            <div className="space-y-3">
              <div className="flex items-center justify-between px-2 pt-1">
                <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Workspace Channels</span>
                <button
                  type="button"
                  onClick={() => setIsCreateChannelOpen(true)}
                  className="p-1 rounded text-slate-300 hover:text-white hover:bg-[#27334D] transition-colors cursor-pointer"
                  title="Create Channel"
                >
                  <Plus size={15} />
                </button>
              </div>

              <div className="relative px-1">
                <Search size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Jump to channel..."
                  value={channelSearch}
                  onChange={e => setChannelSearch(e.target.value)}
                  className="w-full rounded-lg border border-[#2D3A52] bg-[#141B29] pl-7 pr-2.5 py-1 text-[11px] text-white placeholder-slate-400 focus:border-[#E03616] focus:outline-none"
                />
              </div>

              <div className="space-y-1 max-h-[420px] overflow-y-auto px-1">
                {filteredChannels.map(ch => {
                  const isActive = activeChannelId === ch.id;
                  const unread = unreadCounts.channels[ch.id] || 0;
                  
                  return (
                    <button
                      key={ch.id}
                      onClick={() => {
                        setActiveChannel(ch.id);
                        setFilterPinnedOnly(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-all cursor-pointer group ${isActive ? 'bg-[#27334D] text-white font-bold border-l-2 border-[#E03616]' : 'text-slate-300 hover:bg-[#243048] hover:text-white'}`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {ch.isPrivate ? (
                          <Lock size={13} className={isActive ? 'text-[#E03616]' : 'text-slate-400'} />
                        ) : (
                          <Hash size={13} className={isActive ? 'text-[#E03616]' : 'text-slate-400'} />
                        )}
                        <span className="truncate">{ch.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {unread > 0 ? (
                          <span className="bg-[#E03616] text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full font-mono">
                            {unread}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-mono group-hover:text-slate-200">
                            {ch.memberCount || 0}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom Huddle Status */}
            <div className="pt-3 border-t border-[#2D3A52] text-[11px] text-slate-300 px-2 space-y-2 bg-[#161E2E] -mx-3 -mb-3 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#E03616] animate-ping" />
                  <span className="text-white font-semibold text-xs">Live Audio Huddle</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsHuddleOpen(true)}
                  className="text-[10px] text-[#E03616] hover:underline font-bold cursor-pointer"
                  disabled={!connected}
                >
                  Join ({channels.reduce((sum, c) => sum + (c.memberCount || 0), 0)} Active)
                </button>
              </div>
              <div className="text-[10px] text-slate-400">
                Real-time WebRTC via Socket.IO + Mediasoup SFU.
              </div>
            </div>
          </div>

          {/* Right Column - Main Chat */}
          <div className="md:col-span-8 lg:col-span-9 flex flex-col justify-between p-4 bg-white relative">
            {/* Channel Header Bar */}
            <div className="border-b border-[#D8E2EC] pb-3 mb-2 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-[#0F172A] flex items-center gap-1 font-mono">
                    {activeChannel?.isPrivate ? (
                      <Lock size={16} className="text-[#E03616]" />
                    ) : (
                      <Hash size={16} className="text-[#E03616]" />
                    )}
                    {activeChannel?.name}
                  </span>
                  <Badge variant="frost" className="text-[10px] text-[#1B2436] font-mono">
                    <Users size={11} className="mr-1 inline text-[#54657E]" />
                    {activeChannel?.memberCount || 0} members
                  </Badge>
                </div>
                <div className="mt-0.5 text-xs text-[#54657E] max-w-xl truncate">
                  {activeChannel?.description}
                  {activeChannel?.topic && (
                    <span className="ml-2 font-mono text-[11px] text-[#1B2436] font-medium border-l border-[#D8E2EC] pl-2">
                      Topic: {activeChannel.topic}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFilterPinnedOnly(!filterPinnedOnly)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${filterPinnedOnly ? 'bg-[#E03616]/10 text-[#E03616] border-[#E03616]/30 font-semibold' : 'border-[#D8E2EC] text-[#54657E] hover:bg-[#F0F4F8]'}`}
                  title="Filter Pinned Messages"
                >
                  <Pin size={12} className={filterPinnedOnly ? 'rotate-45' : ''} />
                  <span>Pinned</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsHuddleOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#1B2436] text-white hover:bg-[#27334D] text-xs font-semibold transition-colors cursor-pointer shadow-xs"
                  title="Start Huddle in this Channel"
                  disabled={!connected}
                >
                  <Video size={13} className="text-[#E03616]" />
                  <span>Huddle</span>
                </button>
              </div>
            </div>

            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto max-h-[420px] pr-2 space-y-2">
              {currentChannelMessages.length === 0 ? (
                <div className="py-20 text-center space-y-2">
                  <div className="h-10 w-10 mx-auto rounded-full bg-[#F0F4F8] flex items-center justify-center text-[#54657E]">
                    <MessageSquare size={18} />
                  </div>
                  <h4 className="text-sm font-bold text-[#0F172A]">
                    {filterPinnedOnly ? 'No pinned messages in this channel' : `Welcome to #${activeChannel?.name || 'general'}`}
                  </h4>
                  <p className="text-xs text-[#64748B] max-w-sm mx-auto">
                    {filterPinnedOnly ? 'Hover over any message and click the pin icon to pin important operational guidelines.' : 'Send a message or attach workspace documents to start collaborating.'}
                  </p>
                  {!connected && (
                    <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-xs">
                      Not connected to real-time server. Messages will not sync.
                    </div>
                  )}
                </div>
              ) : (
                <MessageList
                  messages={currentChannelMessages as any}
                  currentUserName={userFullName}
                  onOpenThread={handleOpenThread}
                  onToggleReaction={handleToggleReaction}
                  onTogglePin={handleTogglePin}
                  onDownloadFile={f => alert(`Downloading "${f.fileName}"...`)}
                />
              )}
            </div>

            {/* Rich Message Composer */}
            <div className="mt-3">
              <MessageComposer
                onSendMessage={handleSendMessage}
                placeholder={`Message #${activeChannel?.name || 'general'}...`}
                availableFiles={[]}
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Living Notes & Knowledge Docs */}
      {activeTab === 'notes' && (
        <SharedNotesView
          notes={[]}
          onCreateNote={handleCreateNote}
          onUpdateNote={handleUpdateNote}
          onDeleteNote={handleDeleteNote}
          currentUserName={userFullName}
          currentUserRole={userRole}
        />
      )}

      {/* Tab 3: Workspace Files Vault */}
      {activeTab === 'files' && (
        <WorkspaceFilesView
          files={[]}
          onUploadFile={handleUploadFile}
          onDeleteFile={handleDeleteFile}
          currentUserName={userFullName}
        />
      )}

      {/* Slide-Out Thread Drawer */}
      <ThreadDrawer
        isOpen={!!activeThreadMessage}
        onClose={closeThread}
        parentMessage={activeThreadMessage as unknown as MessageRecord | null}
        replies={activeThreadReplies as unknown as ThreadReplyRecord[]}
        onSendReply={handleSendThreadReply}
      />

      {/* Create Channel Modal */}
      <CreateChannelModal
        isOpen={isCreateChannelOpen}
        onClose={() => setIsCreateChannelOpen(false)}
        onCreateChannel={handleCreateChannel}
        currentUserId={userId}
      />

      {/* Huddle Demonstration Modal */}
      <HuddleModal
        isOpen={isHuddleOpen}
        onClose={() => setIsHuddleOpen(false)}
        huddle={{ 
          id: 'hud_general', 
          channelId: activeChannelId || 'ch_general', 
          channelName: activeChannel?.name || 'general', 
          isActive: true, 
          startedAt: '10:00 AM', 
          participants: [], 
          meetingNotes: '' 
        }}
        onUpdateNotes={handleUpdateHuddleNotes}
        currentUserId={userId}
      />
    </div>
  );
}

export default CollaborationViewRealTime;