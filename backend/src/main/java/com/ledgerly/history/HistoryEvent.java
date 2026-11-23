package com.ledgerly.history;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "history_events")
public class HistoryEvent {
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "receipt_id")
    private UUID receiptId;

    @Column(name = "event_type", nullable = false)
    private String eventType;

    @Column(nullable = false)
    private String description;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected HistoryEvent() {}

    public HistoryEvent(UUID userId, UUID receiptId, String eventType, String description) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.receiptId = receiptId;
        this.eventType = eventType;
        this.description = description;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public UUID getReceiptId() { return receiptId; }
    public String getEventType() { return eventType; }
    public String getDescription() { return description; }
    public Instant getCreatedAt() { return createdAt; }
}
