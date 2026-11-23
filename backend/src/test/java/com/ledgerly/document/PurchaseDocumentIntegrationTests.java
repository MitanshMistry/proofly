package com.ledgerly.document;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ledgerly.auth.UserAccountRepository;
import com.ledgerly.receipt.ReceiptRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PurchaseDocumentIntegrationTests {
    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    UserAccountRepository users;

    @Autowired
    ReceiptRepository receipts;

    @Autowired
    PurchaseDocumentRepository documents;

    @BeforeEach
    void clearRepositories() {
        documents.deleteAll();
        receipts.deleteAll();
        users.deleteAll();
    }

    @Test
    void uploadDownloadListAndDeleteSupportingDocument() throws Exception {
        MockHttpSession session = register("documents@example.com", "Document Owner");
        String receiptId = createReceipt(session);

        MvcResult upload = mockMvc.perform(multipart("/api/purchases/" + receiptId + "/documents")
                        .file(new MockMultipartFile("file", "warranty.png", "image/png", "proof".getBytes()))
                        .param("documentType", "WARRANTY")
                        .with(csrf())
                        .session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.documentType").value("WARRANTY"))
                .andReturn();

        JsonNode uploaded = objectMapper.readTree(upload.getResponse().getContentAsString());
        String documentId = uploaded.get("id").asText();

        mockMvc.perform(get("/api/purchases/" + receiptId + "/documents").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(documentId));

        mockMvc.perform(get("/api/purchases/" + receiptId + "/documents/" + documentId).session(session))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.IMAGE_PNG))
                .andExpect(content().bytes("proof".getBytes()));

        mockMvc.perform(delete("/api/purchases/" + receiptId + "/documents/" + documentId)
                        .with(csrf())
                        .session(session))
                .andExpect(status().isNoContent());

        assertThat(documents.findByReceiptId(java.util.UUID.fromString(receiptId))).isEmpty();
        mockMvc.perform(get("/api/purchases/" + receiptId + "/documents/" + documentId).session(session))
                .andExpect(status().isNotFound());
    }

    @Test
    void anotherUserCannotListDownloadOrDeleteDocument() throws Exception {
        MockHttpSession owner = register("owner-docs@example.com", "Owner");
        MockHttpSession other = register("other-docs@example.com", "Other");
        String receiptId = createReceipt(owner);

        MvcResult upload = mockMvc.perform(multipart("/api/purchases/" + receiptId + "/documents")
                        .file(new MockMultipartFile("file", "receipt.png", "image/png", "secret".getBytes()))
                        .param("documentType", "RECEIPT")
                        .with(csrf())
                        .session(owner))
                .andExpect(status().isOk())
                .andReturn();
        String documentId = objectMapper.readTree(upload.getResponse().getContentAsString()).get("id").asText();

        mockMvc.perform(get("/api/purchases/" + receiptId + "/documents").session(other))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/purchases/" + receiptId + "/documents/" + documentId).session(other))
                .andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/purchases/" + receiptId + "/documents/" + documentId)
                        .with(csrf())
                        .session(other))
                .andExpect(status().isNotFound());

        assertThat(documents.findByReceiptId(java.util.UUID.fromString(receiptId))).hasSize(1);
    }

    @Test
    void deletingReceiptDeletesOwnedSupportingDocuments() throws Exception {
        MockHttpSession session = register("receipt-delete@example.com", "Receipt Owner");
        String receiptId = createReceipt(session);

        mockMvc.perform(multipart("/api/purchases/" + receiptId + "/documents")
                        .file(new MockMultipartFile("file", "box.png", "image/png", "box".getBytes()))
                        .param("documentType", "BOX")
                        .with(csrf())
                        .session(session))
                .andExpect(status().isOk());

        mockMvc.perform(delete("/api/receipts/" + receiptId).with(csrf()).session(session))
                .andExpect(status().isNoContent());

        assertThat(documents.findAll()).isEmpty();
        assertThat(receipts.findAll()).isEmpty();
    }

    private MockHttpSession register(String email, String displayName) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new AuthPayload(email, displayName, "Password123"))))
                .andExpect(status().isCreated())
                .andReturn();
        return (MockHttpSession) result.getRequest().getSession(false);
    }

    private String createReceipt(MockHttpSession session) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/receipts")
                        .with(csrf())
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "merchantName":"Target",
                                  "purchasedAt":"2026-11-18",
                                  "total":86.40,
                                  "category":"Shopping"
                                }
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    private record AuthPayload(String email, String displayName, String password) {}
}
