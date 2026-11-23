package com.ledgerly.auth;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ledgerly.receipt.ReceiptRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthIntegrationTests {
    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    UserAccountRepository users;

    @Autowired
    ReceiptRepository receipts;

    @BeforeEach
    void clearRepositories() {
        receipts.deleteAll();
        users.deleteAll();
    }

    @Test
    void registerLoginLogoutAndMeWorkWithARealSession() throws Exception {
        MockHttpSession session = register("one@example.com", "First User");

        mockMvc.perform(get("/api/auth/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("one@example.com"))
                .andExpect(jsonPath("$.displayName").value("First User"));

        mockMvc.perform(post("/api/auth/logout").with(csrf()).session(session))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/auth/me").session(session))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void loginRejectsWrongPasswordAndDuplicateRegistrationIsConflict() throws Exception {
        register("two@example.com", "Second User");

        mockMvc.perform(post("/api/auth/login")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"two@example.com","password":"WrongPassword"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.message").value("Email or password is incorrect"));

        mockMvc.perform(post("/api/auth/register")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"two@example.com","displayName":"Duplicate","password":"Password123"}
                                """))
                .andExpect(status().isConflict());
    }

    @Test
    void oneUserCannotReadAnotherUsersReceipt() throws Exception {
        MockHttpSession firstSession = register("owner@example.com", "Owner");
        MockHttpSession otherSession = register("other@example.com", "Other");

        MvcResult createResult = mockMvc.perform(post("/api/receipts")
                        .with(csrf())
                        .session(firstSession)
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

        JsonNode receipt = objectMapper.readTree(createResult.getResponse().getContentAsString());
        String receiptId = receipt.get("id").asText();

        mockMvc.perform(get("/api/receipts/" + receiptId).session(otherSession))
                .andExpect(status().isNotFound());

        mockMvc.perform(delete("/api/receipts/" + receiptId).with(csrf()).session(otherSession))
                .andExpect(status().isNotFound());
    }

    private MockHttpSession register(String email, String displayName) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new AuthPayload(email, displayName, "Password123"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.email").value(email))
                .andReturn();

        return (MockHttpSession) result.getRequest().getSession(false);
    }

    private record AuthPayload(String email, String displayName, String password) {}
}
