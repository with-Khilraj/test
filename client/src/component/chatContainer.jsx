import React, { useEffect, useRef, useState } from "react";
import api from "../Api";
import { useNavigate } from "react-router-dom";
import moment from "moment";
import "../styles/chatContainer.css";
import socket from "./socket";
import { useOnlineUsers } from "../context/onlineUsersContext";
import audio_call from "../assets/call.png";
import video_call from "../assets/video-camera.png";
import info_icon from "../assets/info.png";
import audio_icon from "../assets/mic.png";
import media_icon from "../assets/image-gallery.png";
import mongoose from 'mongoose';


const ChatContainer = ({ selectedUser, currentUser }) => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunk, setAudioChunk] = useState([]);
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showProfileInfo, setShowProfileInfo] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const typingTimeout = useRef(null);
  const messageEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const onlineUsers = useOnlineUsers();

  useEffect(() => {
    if (selectedUser) {
      const roomId = [currentUser._id, selectedUser._id].sort().join("-");
      socket.emit("join-room", roomId);

      const fetchChatHistory = async () => {
        try {
          const accessToken = localStorage.getItem("accessToken");
          const response = await api.get(`/api/messages/${selectedUser._id}`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });
          setMessages(response.data.messages);

          // Mark all unread messages as 'seen'
          const unreadMessages = response.data.messages.filter(
            (msg) => msg.receiverId === currentUser._id && msg.status === 'sent'
          );
          if(unreadMessages.length > 0) {
            await api.put('/api/messages/status/bulk', {
              messageIds: unreadMessages.map((msg) => msg._id), status: 'seen' },
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );
          }
        } catch (error) {
          console.error("Error fetching chat history:", error);
        }
      };
      fetchChatHistory();

      // handle receive message
      const handleReceiveMessage = (data) => {
        setMessages((prevMessages) => {
          if (data.senderId !== currentUser._id && !prevMessages.some((msg) => msg._id === data._id)) {
            const updateMessages = [...prevMessages, data];
            console.log("Updated messages:::", updateMessages);
            return updateMessages;
          }
          return prevMessages;
        });
      };

      // listen for 'receive-message' event
      socket.on("receive-message", handleReceiveMessage);

      // clean up function
      return () => {
        socket.off("receive-message", handleReceiveMessage);
        socket.emit('leave-room', roomId);
      };

    }
  }, [selectedUser, currentUser]);



  useEffect(() => {
    if (selectedUser) {
       // listen for message status updates
       socket.on('message-sent', (data) => {
        setMessages((prevMessages) => 
          prevMessages.map((msg) =>
            msg._id === data.messageId ? { ...msg, status: data.status} : msg
          )
        );
      });

      socket.on('message-seen', (data) => {
        setMessages((prevMessages) => 
          prevMessages.map((msg) =>
            msg._id === data.messageId ? { ...msg, status: data.status} : msg
          )
        );
      });
    }

    // clean up the event listner when the component unmounts
    return () => {
      socket.off('message-sent');
      socket.off('message-seen');
    };
  })


  // hande file input change
  const handleFileInputChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      handleSendMessage(selectedFile);
    } else {
      setFile(null);
    }
  };

  // Trigger file input when an icon is clicked
  const handleMediaClick = (type) => {
    fileInputRef.current.click();
  }

  // handle audio recording
  const handleAudioRecording = async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        setMediaRecorder(recorder);

        recorder.ondataavailable = (e) => {
          setAudioChunk((prev) => [...prev, e.data]);
        };

        recorder.onstop = async () => {
          const audioBlob = new Blob(audioChunk, { type: "audio/wav" });
          setFile(audioBlob);

          handleSendMessage(audioBlob);
          setAudioChunk([]);
        };

        recorder.start();
        setIsRecording(true);
      } catch (e) {
        console.error("Error starting audio recording:", e);
      }
    } else {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  }

  const isValidObjectId = (id) => {
    return /^[0-9a-fA-F]{24}$/.test(id);
  };

  // Handle send message button
  // const handleSendMessage = async () => {
  //   if (!newMessage.trim()) return;

  //   const messageId = uuidv4();
  //   const messageData = {
  //     _id: messageId,
  //     roomId: [currentUser._id, selectedUser._id].sort().join("-"),
  //     senderId: currentUser._id,
  //     receiverId: selectedUser._id,
  //     content: newMessage,
  //   };

  //   try {
  //     setMessages((prevMessages) => [...prevMessages, messageData]); // Optimistic update
  //     setNewMessage("");

  //     socket.emit("send-message", messageData);

  //     const accessToken = localStorage.getItem("accessToken");
  //     const response = await api.post("/api/messages/", messageData, {
  //       headers: {
  //         Authorization: `Bearer ${accessToken}`,
  //       },
  //     });

  //     // Update message with actual ID from server response
  //     setMessages((prevMessages) =>
  //       prevMessages.map((msg) =>
  //         msg._id === Date.now() ? { ...msg, _id: response.data._id } : msg
  //       )
  //     );
  //   } catch (error) {
  //     console.error("Error while sending message:", error);
  //   }
  // };

  const handleSendMessage = async (fileToSend = file) => {
    if (isSending) return true;
    setIsSending(true);

    if (!newMessage.trim() && !fileToSend) {
      setIsSending(false);
      return;
    }

    // Validate receiverId
    if (!selectedUser?._id || !isValidObjectId(selectedUser._id)) {
      setError("Invalid receiver ID. Please select a valid user.");
      setIsSending(false);
      return;
    }

    // const messageId = uuidv4();
    const messageId = new mongoose.Types.ObjectId();

    // Determine messageType based on whether a file is being sent
    let messageType = "text"; // Default to text message
    if (fileToSend && fileToSend instanceof File) {
      if (fileToSend.type.startsWith("audio")) {
        messageType = "audio";
      } else if (fileToSend.type.startsWith("video")) {
        messageType = "video";
      } else if (fileToSend.type.startsWith("image")) {
        messageType = "photo";
      } else {
        messageType = "file";
      }
    }

    const messageData = {
      _id: messageId,
      roomId: [currentUser._id, selectedUser._id].sort().join("-"),
      senderId: currentUser._id,
      receiverId: selectedUser._id,
      content: newMessage.trim(),
      messageType,
      fileUrl: fileToSend && fileToSend instanceof Blob ? URL.createObjectURL(fileToSend) : null, // Temporary URL for preview
      fileName: fileToSend ? fileToSend.name : "",
      fileSize: fileToSend ? fileToSend.size : 0,
      fileType: fileToSend ? fileToSend.type : "",
      duration: messageType === "audio" || messageType === "video"
        ? await getMediaDuration(fileToSend)
        : 0, // Calculate duration for audio/video files
      status: "sent",
    };

    console.log("Constructed MesssageDate::::::", messageData);

    try {
      setIsUploading(true);
      setMessages((prevMessages) => [...prevMessages, messageData]); // Optimistic update
      setNewMessage("");
      setFile(null);

      socket.emit("send-message", messageData);

      const accessToken = localStorage.getItem("accessToken");
      const formData = new FormData();

      // Append only required fields to FormData
      formData.append("roomId", messageData.roomId);
      formData.append("senderId", messageData.senderId);
      formData.append("receiverId", messageData.receiverId); // Explicitly append receiverId
      formData.append("content", messageData.content);
      formData.append("messageType", messageData.messageType);
      formData.append("caption", messageData.caption);
      formData.append("status", messageData.status);

      if (fileToSend && fileToSend instanceof File) {
        formData.append("file", fileToSend);
        formData.append("fileName", messageData.fileName);
        formData.append("fileSize", messageData.fileSize);
        formData.append("fileType", messageData.fileType);
        if (messageData.duration) formData.append("duration", messageData.duration);
      }

      // Send message to server
      const response = await api.post("/api/messages/", formData, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "multipart/form-data",
        },
      });

      // Update message with actual ID from server response
      setMessages((prevMessages) =>
        prevMessages.map((msg) =>
          // msg._id === Date.now() ? { ...msg, _id: response.data._id } : msg
          msg._id === messageId ? { ...msg, _id: response.data._id } : msg
        )
      );
    } catch (error) {
      console.error("Error while sending message:", error);
      if (error.response?.status === 401) {
        navigate('/login');
      }
    } finally {
      setIsUploading(false);
    }
  };

  // Get duration of audio/video files
  const getMediaDuration = (file) => {
    return new Promise((resolve) => {
      const media = document.createElement(file.type.startsWith("audio") ? "audio" : "video");
      media.src = URL.createObjectURL(file);
      media.onloadedmetadata = () => {
        resolve(media.duration);
      };
    });
  };


  // to go the end/last messages of users
  useEffect(() => {
    if (messages.length) {
      messageEndRef.current?.scrollIntoView({ behavior: "smooth" }); 
    }
  }, [messages, currentUser, selectedUser]);


  // when user views the chat, emit 'message-seen' for all the unread messages
  useEffect(() => {
    if (selectedUser) {
      // emit 'message-seen' for all the unread messages
      const unreadMessages = messages.filter(
        (msg) => msg.receiverId === currentUser._id && msg.status === "sent"
      );
      if (unreadMessages.length > 0) {
        socket.emit('message-seen', {
          messageIds: unreadMessages.map((msg) => msg._id),
          roomId: [currentUser._id, selectedUser._id].sort().join("-"),
        })
      }
    }
  }, [selectedUser, currentUser, messages]);

  // Helper: function to render the appropriate status icon
  const renderStatusIndicator = (status) => {
    switch (status) {
      case "sent":
        return <span className="status-sent">✓</span>
      case "seen":
        return <span className="status-seen">✓✓</span>
      default:
        return null;
    }
  };

  // Helper: check if there's a 30 minute or more gap between two messages
  const shouldDisplayTimeStamp = (currentMessage, previousMessage) => {
    if (!previousMessage) return true;

    const currentTime = moment(currentMessage.createdAt);
    const previousTime = moment(previousMessage.createdAt);
    return currentTime.diff(previousTime, "minutes") >= 30;
  };

  // Helper: check if a message should start a new group
  const shouldStartNewGroup = (currentMessage, previousMessage) => {
    if (!previousMessage) return true;

    const currentTime = moment(currentMessage.createdAt);
    const previousTime = moment(previousMessage.createdAt);

    return (
      currentMessage.senderId !== previousMessage.senderId ||
      currentTime.diff(previousTime, "minutes") >= 1
    );
  };

  // function to handle the typing event
  const handleTypingEvent = (e) => {
    setNewMessage(e.target.value);

    // emit typing event
    if (!isTyping) {
      socket.emit('typing', {
        roomId: [currentUser._id, selectedUser._id].sort().join("_"),
        isTyping: true
      });
      setIsTyping(true);
    }

    // clear previous Timeout
    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current);
    }

    // Set timeout to stop typing indicator
    typingTimeout.current = setTimeout(() => {
      socket.emit('typing', {
        roomId: [currentUser._id, selectedUser._id].sort().join("_"),
        isTyping: false,
      });
      setIsTyping(false);
    }, 1000)
  };

  
  // handle profile info change
  const toggleProfileInfo = () => {
    setShowProfileInfo(!showProfileInfo);
  }

  // adding class to the chat-container based on the state of the showProfileInfo
  const chatContainerClass = showProfileInfo ? 'chat-container shrink' : 'chat-container';

  if (!selectedUser) {
    return (
      <div className="unselected-chat">Select a user to start chatting!</div>
    );
  }

  return (
    <>
      <div className={chatContainerClass}>
        <div className="chat-header">
          <div className="user-profile-name">
            <div className="chat-avatar">
              {selectedUser.avatar ? (
                <img src={selectedUser.avatar} alt="" />
              ) : (
                <span>{selectedUser.username.charAt(0).toUpperCase()}</span>
              )}
              {onlineUsers.includes(selectedUser._id) && (
                <span className="online-indicator"></span>
              )}
            </div>
            <h3 className="chat-username">
              {selectedUser.username}
              <br></br>
              {onlineUsers.includes(selectedUser._id) && (
                <span className="online-status">Active now</span>
              )}
            </h3>
          </div>

          {/* adding video and audio call icons */}
          <div className="chat-call-icons">
            <button className="video-call-icon">
              <img src={video_call} alt="" />
            </button>
            <button className="audio-call-icon">
              <img src={audio_call} alt="" />
            </button>
            <button className="info-icon" onClick={toggleProfileInfo}>
              <img src={info_icon} alt="" />
            </button>
          </div>
        </div>

        <div className="chat-messages">
          {messages.map((message, index) => {
            const isCurrentUser = message.senderId === currentUser._id;
            const senderUser = isCurrentUser ? currentUser : selectedUser;
            const previousMessage = messages[index - 1];
            // const nextMessage = messages[index + 1];
            const showTimeStamp = shouldDisplayTimeStamp(
              message,
              previousMessage,
            );
            const startNewGroup = shouldStartNewGroup(message, previousMessage);

            return (
              <div key={index}>
                {/* show timestamp if necessary */}
                {showTimeStamp && (
                  <div className="message-timestamp">
                    {moment(message.createdAt || Date.now()).format(
                      "D MMM YYYY, HH:mm"
                    )}
                  </div>
                )}

                <div
                  className={`message-group ${isCurrentUser ? "sent" : "received"
                    }`}
                >
                  {!isCurrentUser && startNewGroup && (
                    <div className="avatar-content">
                      {/* Avatar or Initial char of username */}
                      <div className="message-avatar">
                        {senderUser.avatar ? (
                          <img src={senderUser.avatar} alt="" />
                        ) : (
                          <span className="message-initial">
                            {senderUser.username.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                </div>

                {/* Message abubble */}
                <div
                  className={`message ${message.senderId === currentUser._id ? "sent" : "received"
                    }`}
                >
                  {message.messageType === "text" && <p className="text-message">{message.content}</p>}
                  {message.messageType === "photo" && (
                    <div className="for-photo">
                      <img src={message.fileUrl} alt={message.fileName} className="media-message" />
                    </div>
                  )}
                  {message.messageType === "video" && (
                    <div>
                      <video controls src={message.fileUrl} className="video-message" />
                    </div>
                  )}
                  {message.messageType === "audio" && (
                    <div>
                      <audio controls src={message.fileUrl} className="audio-message" />
                    </div>
                  )}
                  {message.messageType === "file" && (
                    <div>
                      <a href={message.fileUrl} download={message.fileName} className="file-message">
                        {message.fileName}
                      </a>
                    </div>
                  )}

                  {/* status indicator */}
                  {message.senderId === currentUser._id && (
                    <div className="message-status">
                    {renderStatusIndicator(message.status)}
                  </div>
                  )}            
                </div>
              </div>
            );
          })}
          <div ref={messageEndRef}></div>

        </div>

        {/* message input */}
        <div className="chat-input">
          <div className="media-icons">
            <button onClick={handleMediaClick}>
              <img src={media_icon} alt="Media" />
            </button>
            {/* Icon for audio (if needed) */}
            <button onClick={handleAudioRecording}>
              <img src={audio_icon} alt="Audio" />
            </button>
          </div>

          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type your message..."
          />
         
          <button onClick={handleSendMessage} disabled={isUploading}>
            {isUploading ? "Sending" : "Send"}
          </button>

          {/* Hidden file input for media (photos, videos, files) */}
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={handleFileInputChange}
            accept="image/*, video/*, .pdf, .doc, .docx" // Allow photos, videos, and files
          />
        </div>
      </div>

      {/* Profile Info Container */}
      <div className={`profile-info ${showProfileInfo ? 'show' : ''}`}>
        <div className="profile-pic">
          {selectedUser && (
            <div className="user-profile-pic">
              {selectedUser.avatar ? (
                <img src={selectedUser.avatar} alt="" />
              ) : (
                <span className="user-initial-char">
                  {selectedUser.username.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="profile-user-name">
          {selectedUser && (
            <h3>{selectedUser.username}</h3>
          )}
        </div>
        {/* Profile content goes here */}
        <p>Additional details about the current user...</p>
      </div>
    </>
  );
};

export default ChatContainer;